/**
 * Goalie projection v2: walk-forward stacked ensemble with structural
 * components.
 *
 * Targets: wins/gp, saves/gp, shutouts/gp, savePct (plus GP separately).
 * Signals per target:
 *  - gbdt / ridge on a goalie feature matrix (trajectories + team + bio + GSAx)
 *  - marcel: EB-shrunk decay-weighted career rate
 *  - ewma / lag1 persistence
 *  - structural: decomposed from team context and shot-quality-adjusted
 *    goalie skill (GSAx): saves = SA/g × (fraction stopped), wins = f(team
 *    strength, goalie quality), shutouts = Poisson(0 | GA/g), savePct =
 *    league mean + shrunk GSAx-per-shot.
 */

import { fitGbdt, predictGbdt, predictGbdtBatch, type GbdtModel, type GbdtOptions } from "./gbdt";
import {
  buildTargetLevels,
  gp82,
  historyLevelAnchor,
  levelEstimate,
} from "./dataset-view";
import { sanitizeTargetSeasonRow } from "./features";
import {
  loadMoneyPuckRegistrySync,
  lookupMoneyPuckGoalieSeason,
  type MoneyPuckGoalieRegistry,
} from "../moneypuck-goalies";
import { applyRateCalibrator, fitAffineCalibrator, fitMetaConvex, fitMetaNnls, fitRidgeV2, predictRidgeV2, applyMeta, marketTrainingEnabled, type MetaWeights, type RateCalibrator, type RidgeV2 } from "./stack";
import { DISAGREEMENT_SIGMA, disagreementWeight, sampleStd } from "./market-training";
import type { PlayerSeasonRow } from "./types";

export const GOALIE_V2_TARGETS = ["wins", "saves", "shutouts", "savePct"] as const;
export type GoalieV2Target = (typeof GOALIE_V2_TARGETS)[number];

export const GOALIE_SIGNALS = [
  "gbdt",
  "ridge",
  "marcel",
  "ewma",
  "lag1",
  "structural",
  "market",
] as const;
export type GoalieSignal = (typeof GOALIE_SIGNALS)[number];

const GOALIE_MIN_ELIGIBLE_GP = 8;

export function goalieEligible(history: PlayerSeasonRow[]): PlayerSeasonRow[] {
  return history.filter((r) => r.gamesPlayed >= GOALIE_MIN_ELIGIBLE_GP);
}

/** Per-game rate for count targets; savePct passes through as a proportion. */
export function goalieActual(row: PlayerSeasonRow, target: string): number {
  if (target === "savePct") {
    const v = row.savePct;
    return v > 1 ? v / 100 : v;
  }
  const v = (row as unknown as Record<string, number>)[target] ?? 0;
  return row.gamesPlayed > 0 ? v / row.gamesPlayed : 0;
}

// ---------------------------------------------------------------------------
// Feature matrix

function lagNames(stat: string): string[] {
  return [`${stat}_lag1`, `${stat}_lag2`, `${stat}_lag3`, `${stat}_ewma`, `${stat}_trend`];
}

export const GOALIE_V2_FEATURES: string[] = [
  ...lagNames("gp82"),
  ...lagNames("team_share"),
  "career_gp",
  "prior_seasons",
  // Game-log durability. Goalies sit as healthy backups, so absence is only
  // an injury signal for long gaps (8+ team games) — starters never sit that
  // long by rotation alone.
  "inj8_82_lag1",
  "inj8_82_ewma",
  "spells8_lag1",
  "longest_gap_lag1",
  "tail82_lag1",
  "chronic_inj8",
  // Ironman + back-to-back workload (starters rarely play both B2B nights)
  "streak_lag1",
  "full_season_lag1",
  "team_b2b_lag1",
  "b2b_gp_cap",
  "age",
  "age_sq",
  "height_in",
  "draft_overall",
  ...lagNames("wins_pg"),
  ...lagNames("saves_pg"),
  ...lagNames("shutouts_pg"),
  ...lagNames("savePct"),
  ...lagNames("gsax60"),
  ...lagNames("xsvpct_delta"),
  ...lagNames("workload_sa60"),
  "sv_shrunk",
  "gsax60_shrunk",
  "team_ga_pg",
  "team_gf_pg",
  "team_point_pct",
  "team_elo",
  "team_sa_pg",
  "team_changed",
  "league_svpct",
];

export interface GoalieExample {
  playerId: number;
  seasonId: number;
  targetRow: PlayerSeasonRow;
  actualRow: PlayerSeasonRow;
  history: PlayerSeasonRow[];
}

export interface GoalieLeagueContext {
  /** seasonId → league save% that season (regular season, all goalies). */
  svPct: Map<number, number>;
  /** seasonId → mean team shots against per game. */
  saPerGame: Map<number, number>;
  /** `${team}:${seasonId}` → team SA/game. */
  teamSaPerGame: Map<string, number>;
  /** `${team}:${seasonId}` → total goalie GP for that team-season. */
  teamGoalieGp: Map<string, number>;
}

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

/** Damped-trend estimate over a seasonId→value map (pre-season information only). */
function trendLevel(m: Map<number, number>, seasonId: number, fallback: number): number {
  const rec: Record<number, number> = {};
  for (const [s, v] of m) rec[s] = v;
  const est = levelEstimate(rec, seasonId);
  return Number.isFinite(est) ? est : fallback;
}

/** Per-target goalie league levels (saves, savePct) for era normalization. */
export type GoalieLevels = Record<string, Record<number, number>>;

export function buildGoalieLevels(rows: PlayerSeasonRow[]): GoalieLevels {
  return buildTargetLevels(rows, ["saves", "savePct"], true, GOALIE_MIN_ELIGIBLE_GP);
}

/** Known league level of a completed season, with global-mean fallback. */
function knownLevel(rec: Record<number, number> | undefined, seasonId: number): number {
  const v = rec?.[seasonId];
  if (v != null && Number.isFinite(v) && v > 0) return v;
  if (!rec) return NaN;
  const vals = Object.values(rec).filter((x) => Number.isFinite(x) && x > 0);
  return vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : NaN;
}

/**
 * Era-relative encode/decode for model targets. saves scales with league shot
 * volume (multiplicative); savePct shifts with the league save% environment
 * (additive). Training uses the actual season's known level; prediction uses
 * the pre-season trend estimate.
 */
function toRelative(
  target: GoalieV2Target,
  y: number,
  levels: GoalieLevels,
  seasonId: number,
): number {
  if (target === "saves") {
    const lvl = knownLevel(levels.saves, seasonId);
    return Number.isFinite(lvl) && lvl > 0 ? y / lvl : y;
  }
  if (target === "savePct") {
    const lvl = knownLevel(levels.savePct, seasonId);
    return Number.isFinite(lvl) ? y - lvl : y;
  }
  return y;
}

function fromRelative(
  target: GoalieV2Target,
  rel: number,
  levels: GoalieLevels,
  seasonId: number,
): number {
  if (target === "saves") {
    const lvl = levelEstimate(levels.saves, seasonId);
    // Never return raw relative units if the level is missing.
    return Number.isFinite(lvl) && lvl > 0 ? rel * lvl : rel * 28;
  }
  if (target === "savePct") {
    const lvl = levelEstimate(levels.savePct, seasonId);
    return Number.isFinite(lvl) ? rel + lvl : rel + 0.905;
  }
  return rel;
}

/**
 * Era-adjust a persistence signal: saves scale multiplicatively with league
 * shot volume; savePct shifts additively with the league save% environment.
 * Wins/shutouts have no monotone league drift worth correcting.
 */
function goalieEraAdjust(
  target: GoalieV2Target,
  value: number,
  levels: GoalieLevels,
  history: PlayerSeasonRow[],
  seasonId: number,
): number {
  if (!Number.isFinite(value)) return value;
  const eligible = goalieEligible(history);
  if (target === "saves") {
    const anchor = historyLevelAnchor(levels.saves, eligible);
    const lvlT = levelEstimate(levels.saves, seasonId);
    if (!Number.isFinite(anchor) || !Number.isFinite(lvlT) || anchor <= 0) return value;
    return value * Math.max(0.85, Math.min(1.18, lvlT / anchor));
  }
  if (target === "savePct") {
    const anchor = historyLevelAnchor(levels.savePct, eligible);
    const lvlT = levelEstimate(levels.savePct, seasonId);
    if (!Number.isFinite(anchor) || !Number.isFinite(lvlT)) return value;
    const delta = Math.max(-0.006, Math.min(0.006, lvlT - anchor));
    return value + delta;
  }
  return value;
}

export function buildGoalieLeagueContext(rows: PlayerSeasonRow[]): GoalieLeagueContext {
  const svPct = new Map<number, number>();
  const saPerGame = new Map<number, number>();
  const teamSaPerGame = new Map<string, number>();
  const teamGoalieGp = new Map<string, number>();

  const bySeason = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    if (!r.isGoalie) continue;
    const list = bySeason.get(r.seasonId) ?? [];
    list.push(r);
    bySeason.set(r.seasonId, list);
  }

  for (const [seasonId, goalies] of bySeason) {
    let saves = 0;
    let shots = 0;
    const teamAgg = new Map<string, { sa: number; gp: number }>();
    for (const g of goalies) {
      const sv = g.savePct > 1 ? g.savePct / 100 : g.savePct;
      if (sv <= 0 || sv >= 1 || g.saves <= 0) continue;
      const shotsFaced = g.saves / sv;
      saves += g.saves;
      shots += shotsFaced;
      const team = primaryTeam(g.team);
      const agg = teamAgg.get(team) ?? { sa: 0, gp: 0 };
      agg.sa += shotsFaced;
      agg.gp += g.gamesPlayed;
      teamAgg.set(team, agg);
    }
    svPct.set(seasonId, shots > 0 ? saves / shots : 0.905);
    let saSum = 0;
    let saCnt = 0;
    for (const [team, agg] of teamAgg) {
      if (agg.gp < 20) continue;
      const perGame = agg.sa / agg.gp;
      teamSaPerGame.set(`${team}:${seasonId}`, perGame);
      teamGoalieGp.set(`${team}:${seasonId}`, agg.gp);
      saSum += perGame;
      saCnt++;
    }
    saPerGame.set(seasonId, saCnt > 0 ? saSum / saCnt : 30);
  }

  return { svPct, saPerGame, teamSaPerGame, teamGoalieGp };
}

export function buildGoalieExamples(
  rows: PlayerSeasonRow[],
  minTargetGp = 8,
): GoalieExample[] {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    if (!row.isGoalie) continue;
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }
  const examples: GoalieExample[] = [];
  for (const history of byPlayer.values()) {
    history.sort((a, b) => a.seasonId - b.seasonId);
    for (let i = 1; i < history.length; i++) {
      const raw = history[i];
      if (raw.gamesPlayed < minTargetGp) continue;
      const prior = history.slice(0, i);
      if (goalieEligible(prior).length < 1) continue;
      examples.push({
        playerId: raw.playerId,
        seasonId: raw.seasonId,
        targetRow: sanitizeTargetSeasonRow(raw, rows),
        actualRow: raw,
        history: prior,
      });
    }
  }
  return examples;
}

interface MpDerived {
  gsax60: number;
  xsvpctDelta: number;
  sa60: number;
}

function mpDerived(
  registry: MoneyPuckGoalieRegistry | null,
  row: PlayerSeasonRow,
): MpDerived | null {
  const mp = lookupMoneyPuckGoalieSeason(registry, row.playerId, row.seasonId);
  if (!mp || mp.icetimeSeconds <= 0) return null;
  const minutes = mp.icetimeSeconds / 60;
  const gsax60 = (mp.gsax / minutes) * 60;
  const sa60 = (mp.shotsOnGoalAgainst / minutes) * 60;
  const actualSv =
    mp.shotsOnGoalAgainst > 0 ? 1 - mp.goalsAgainst / mp.shotsOnGoalAgainst : 0.905;
  const expectedSv =
    mp.shotsOnGoalAgainst > 0 ? 1 - mp.xGoalsAgainst / mp.shotsOnGoalAgainst : 0.905;
  return { gsax60, xsvpctDelta: actualSv - expectedSv, sa60 };
}

function pushLags(out: number[], vals: number[]): void {
  const l1 = vals.length >= 1 ? vals[vals.length - 1] : NaN;
  const l2 = vals.length >= 2 ? vals[vals.length - 2] : NaN;
  const l3 = vals.length >= 3 ? vals[vals.length - 3] : NaN;
  const w = [0.5, 0.3, 0.2];
  let sum = 0;
  let ws = 0;
  [l1, l2, l3].forEach((v, i) => {
    if (Number.isFinite(v)) {
      sum += v * w[i];
      ws += w[i];
    }
  });
  out.push(l1, l2, l3, ws > 0 ? sum / ws : NaN, Number.isFinite(l1) && Number.isFinite(l2) ? l1 - l2 : NaN);
}

/** EB-shrunk career save% (decay 0.8, prior ~1000 shots at league mean).
 * Prior was cut to 400 for elite separation, but that under-shrinks a YoY-r≈0.3
 * skill signal and drives negative OOS R². 1000 balances rank spread vs luck. */
function shrunkSavePct(
  eligible: PlayerSeasonRow[],
  leagueMean: number,
): number {
  let saves = 0;
  let shots = 0;
  let w = 1;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const g = eligible[i];
    const sv = g.savePct > 1 ? g.savePct / 100 : g.savePct;
    if (sv <= 0 || sv >= 1 || g.saves <= 0) continue;
    const shotsFaced = g.saves / sv;
    saves += w * g.saves;
    shots += w * shotsFaced;
    w *= 0.8;
  }
  const PRIOR_SHOTS = 1200;
  return (saves + PRIOR_SHOTS * leagueMean) / Math.max(1, shots + PRIOR_SHOTS);
}

/** EB-shrunk GSAx/60 (decay 0.8, prior 900 minutes at 0).
 * Prior was 2000 — too aggressive for established starters. */
function shrunkGsax60(
  eligible: PlayerSeasonRow[],
  registry: MoneyPuckGoalieRegistry | null,
): number {
  let gsax = 0;
  let minutes = 0;
  let w = 1;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const mp = lookupMoneyPuckGoalieSeason(registry, eligible[i].playerId, eligible[i].seasonId);
    if (mp && mp.icetimeSeconds > 0) {
      gsax += w * mp.gsax;
      minutes += (w * mp.icetimeSeconds) / 60;
    }
    w *= 0.8;
  }
  if (minutes <= 0) return 0;
  const rate = (gsax / minutes) * 60;
  return rate * (minutes / (minutes + 900));
}

export function goalieFeatureVector(
  history: PlayerSeasonRow[],
  target: PlayerSeasonRow,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
): number[] {
  const eligible = goalieEligible(history);
  const out: number[] = [];
  const prevSeason = target.seasonId - 10001;

  pushLags(out, eligible.map((r) => gp82(r)));
  pushLags(
    out,
    eligible.map((r) => {
      const teamGp = league.teamGoalieGp.get(`${primaryTeam(r.team)}:${r.seasonId}`);
      return teamGp && teamGp > 0 ? r.gamesPlayed / teamGp : NaN;
    }),
  );
  out.push(eligible.reduce((s, r) => s + r.gamesPlayed, 0));
  out.push(eligible.length);

  // Game-log durability (full history; 8+ game gaps = goalie injury proxy)
  const inj8Per82 = (r: PlayerSeasonRow): number =>
    r.dur && r.dur.teamGames > 0
      ? ((r.dur.inj8 + r.dur.tail) * 82) / r.dur.teamGames
      : NaN;
  const recent = history.slice(-3);
  const j = recent.map(inj8Per82);
  const [j1, j2, j3] = [j.at(-1) ?? NaN, j.at(-2) ?? NaN, j.at(-3) ?? NaN];
  const jw = [0.5, 0.3, 0.2];
  let jSum = 0;
  let jWs = 0;
  [j1, j2, j3].forEach((v, i) => {
    if (Number.isFinite(v)) {
      jSum += v * jw[i];
      jWs += jw[i];
    }
  });
  out.push(j1, jWs > 0 ? jSum / jWs : NaN);
  const lastDur = history.at(-1)?.dur;
  out.push(lastDur ? lastDur.spells8 : NaN);
  out.push(lastDur ? lastDur.longestGap : NaN);
  out.push(
    lastDur && lastDur.teamGames > 0 ? (lastDur.tail * 82) / lastDur.teamGames : NaN,
  );
  let cSum = 0;
  let cW = 0;
  let cw = 1;
  for (let i = history.length - 1; i >= 0 && history.length - i <= 6; i--) {
    const v = inj8Per82(history[i]);
    if (Number.isFinite(v)) {
      cSum += cw * v;
      cW += cw;
    }
    cw *= 0.75;
  }
  out.push(cW > 0 ? cSum / cW : NaN);

  // Ironman + B2B workload cap. Starters almost never play both nights of a
  // back-to-back, so expected GP ≈ share × (82 − teamB2b) with a soft floor.
  out.push(lastDur ? lastDur.streak / 82 : NaN);
  out.push(lastDur ? lastDur.fullSeason : NaN);
  out.push(lastDur ? lastDur.teamB2b : NaN);
  if (lastDur && lastDur.teamGames > 0) {
    const lastRow = history.at(-1)!;
    const teamGp = league.teamGoalieGp.get(
      `${primaryTeam(lastRow.team)}:${lastRow.seasonId}`,
    );
    const share =
      teamGp && teamGp > 0 ? lastRow.gamesPlayed / teamGp : lastDur.played / lastDur.teamGames;
    // One night of each B2B is typically the backup → subtract ~0.5×B2B from
    // a full starter's slate, scaled by the goalie's team share.
    const cap = Math.max(20, Math.min(72, share * (82 - 0.55 * lastDur.teamB2b)));
    out.push(cap);
  } else {
    out.push(NaN);
  }

  const age = target.age && target.age > 0 ? target.age : NaN;
  out.push(age);
  out.push(Number.isFinite(age) ? ((age - 29) * (age - 29)) / 100 : NaN);
  out.push(target.heightInches ?? NaN);
  out.push(
    target.draftOverallPick && target.draftOverallPick > 0 ? target.draftOverallPick : NaN,
  );

  pushLags(out, eligible.map((r) => goalieActual(r, "wins")));
  pushLags(out, eligible.map((r) => goalieActual(r, "saves")));
  pushLags(out, eligible.map((r) => goalieActual(r, "shutouts")));
  pushLags(out, eligible.map((r) => goalieActual(r, "savePct")));

  const mpVals = eligible.map((r) => mpDerived(registry, r));
  pushLags(out, mpVals.map((m) => m?.gsax60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.xsvpctDelta ?? NaN));
  pushLags(out, mpVals.map((m) => m?.sa60 ?? NaN));

  const leagueSv = league.svPct.get(prevSeason) ?? 0.905;
  out.push(shrunkSavePct(eligible, leagueSv));
  out.push(shrunkGsax60(eligible, registry));

  out.push(target.teamGoalsAgainstPerGame ?? NaN);
  out.push(target.teamGoalsForPerGame ?? NaN);
  out.push(target.teamPointPctg ?? NaN);
  out.push(target.teamElo != null ? target.teamElo / 1000 : NaN);
  const targetTeam = primaryTeam(target.team);
  out.push(league.teamSaPerGame.get(`${targetTeam}:${prevSeason}`) ?? NaN);
  const lastTeam =
    history.length > 0 ? primaryTeam(history[history.length - 1].team) : "";
  out.push(lastTeam && targetTeam ? (lastTeam === targetTeam ? 0 : 1) : NaN);
  out.push(leagueSv);

  return out;
}

export interface GoalieMatrix {
  featureNames: string[];
  columns: Float64Array[];
  nRows: number;
}

export function buildGoalieMatrix(
  examples: GoalieExample[],
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
): GoalieMatrix {
  const nCols = GOALIE_V2_FEATURES.length;
  const columns = Array.from({ length: nCols }, () => new Float64Array(examples.length));
  for (let i = 0; i < examples.length; i++) {
    const vec = goalieFeatureVector(examples[i].history, examples[i].targetRow, league, registry);
    for (let j = 0; j < nCols; j++) columns[j][i] = vec[j];
  }
  return { featureNames: [...GOALIE_V2_FEATURES], columns, nRows: examples.length };
}

// ---------------------------------------------------------------------------
// Structural signals

export interface GoalieStructuralParams {
  /** wins_pg = clamp(a + b·(teamPointPct−.5) + c·gsax60shrunk) */
  winsA: number;
  winsB: number;
  winsC: number;
  /** shutout calibration multiplier on Poisson(0 | GA/g). */
  shutoutCal: number;
}

/** Fit tiny structural regressions on train rows only. */
export function fitGoalieStructural(
  trainExamples: GoalieExample[],
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
): GoalieStructuralParams {
  // wins_pg ~ teamPointPct + gsax via 3-param least squares.
  const X: number[][] = [];
  const y: number[] = [];
  for (const ex of trainExamples) {
    if (ex.actualRow.gamesPlayed < 15) continue;
    const ppRaw = ex.targetRow.teamPointPctg;
    if (ppRaw == null) continue;
    // Same shrinkage applied at prediction time.
    const pp = 0.5 + 0.65 * (ppRaw - 0.5);
    const g60 = shrunkGsax60(goalieEligible(ex.history), registry);
    X.push([1, pp - 0.5, g60]);
    y.push(goalieActual(ex.actualRow, "wins"));
  }
  let winsA = 0.5;
  let winsB = 0.9;
  let winsC = 0.15;
  if (X.length >= 50) {
    // Normal equations for 3 params.
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const b = [0, 0, 0];
    for (let i = 0; i < X.length; i++) {
      for (let a = 0; a < 3; a++) {
        b[a] += X[i][a] * y[i];
        for (let c = 0; c < 3; c++) A[a][c] += X[i][a] * X[i][c];
      }
    }
    for (let a = 0; a < 3; a++) A[a][a] += 1e-6;
    // Solve 3x3 via Cramer-ish Gaussian elimination.
    const M = A.map((row, i) => [...row, b[i]]);
    for (let col = 0; col < 3; col++) {
      let piv = col;
      for (let r = col + 1; r < 3; r++) {
        if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      }
      [M[col], M[piv]] = [M[piv], M[col]];
      const div = M[col][col] || 1e-12;
      for (let r = col + 1; r < 3; r++) {
        const f = M[r][col] / div;
        for (let c = col; c <= 3; c++) M[r][c] -= f * M[col][c];
      }
    }
    const sol = [0, 0, 0];
    for (let r = 2; r >= 0; r--) {
      let s = M[r][3];
      for (let c = r + 1; c < 3; c++) s -= M[r][c] * sol[c];
      sol[r] = s / (M[r][r] || 1e-12);
    }
    if (Number.isFinite(sol[0]) && sol[0] > 0.2 && sol[0] < 0.8) {
      winsA = sol[0];
      winsB = Math.max(0, Math.min(2, sol[1]));
      winsC = Math.max(0, Math.min(1, sol[2]));
    }
  }

  // Shutout calibration: SA × league SV% (not skill SV%, not xGA — shrunk xGA
  // flattened ranks in OOS tests). Same recipe as prediction.
  let poisSum = 0;
  let actSum = 0;
  let n = 0;
  for (const ex of trainExamples) {
    if (ex.actualRow.gamesPlayed < 15) continue;
    const eligible = goalieEligible(ex.history);
    if (eligible.length === 0) continue;
    const { leagueSv, saPg } = goalieWorkloadContext(ex, league);
    const gaPg = saPg * (1 - leagueSv);
    poisSum += Math.exp(-gaPg);
    actSum += goalieActual(ex.actualRow, "shutouts");
    n++;
  }
  const shutoutCal = n > 30 && poisSum > 0 ? actSum / poisSum : 1;

  return { winsA, winsB, winsC, shutoutCal: Math.max(0.4, Math.min(2.5, shutoutCal)) };
}

/** Shared SA/SV context for structural signals and shutout calibration. */
function goalieWorkloadContext(
  ex: { history: PlayerSeasonRow[]; targetRow: PlayerSeasonRow; seasonId: number },
  league: GoalieLeagueContext,
): { eligible: PlayerSeasonRow[]; leagueSv: number; sv: number; saPg: number } {
  const eligible = goalieEligible(ex.history);
  const prevSeason = ex.seasonId - 10001;
  const leagueSv = trendLevel(league.svPct, ex.seasonId, 0.905);
  const leagueSaPg = trendLevel(league.saPerGame, ex.seasonId, 30);
  const sv = shrunkSavePct(eligible, leagueSv);
  const teamSaRaw = league.teamSaPerGame.get(
    `${primaryTeam(ex.targetRow.team)}:${prevSeason}`,
  );
  const teamSa =
    teamSaRaw != null ? 0.6 * teamSaRaw + 0.4 * leagueSaPg : leagueSaPg;
  let ownSaPg = NaN;
  {
    let saves = 0;
    let gp = 0;
    let w = 1;
    for (let i = eligible.length - 1; i >= 0; i--) {
      const g = eligible[i];
      const s = g.savePct > 1 ? g.savePct / 100 : g.savePct;
      if (s > 0 && s < 1 && g.saves > 0) {
        saves += (w * g.saves) / s;
        gp += w * g.gamesPlayed;
      }
      w *= 0.7;
    }
    if (gp > 0) ownSaPg = saves / gp;
  }
  const saPg = Number.isFinite(ownSaPg) ? 0.5 * teamSa + 0.5 * ownSaPg : teamSa;
  return { eligible, leagueSv, sv, saPg };
}

export function goalieStructuralSignal(
  params: GoalieStructuralParams,
  ex: { history: PlayerSeasonRow[]; targetRow: PlayerSeasonRow; seasonId: number },
  target: GoalieV2Target,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
): number {
  const { eligible, leagueSv, sv, saPg } = goalieWorkloadContext(ex, league);
  const gsax60 = shrunkGsax60(eligible, registry);

  switch (target) {
    case "savePct": {
      // No GSAx amplify — YoY reliability is ~0.3; overstating skill drives
      // negative OOS R². Slight GSAx tilt keeps elites ordered without over-dispersion.
      const skill = saPg > 0 ? gsax60 / saPg : 0;
      const fromGsax = leagueSv + skill;
      const fromCareer = sv;
      const blended = 0.45 * fromGsax + 0.55 * fromCareer;
      return Math.max(0.86, Math.min(0.945, blended));
    }
    case "saves":
      // Volume only (SA × league SV%). Skill luck lives in the savePct target;
      // mixing it here destroyed the SA-persistence signal (R² 0.04 vs ceiling ~0.19).
      return Math.max(0, saPg * leagueSv);
    case "wins": {
      // Shrink prior-season team quality toward .500 (moderate persistence).
      const pp = 0.5 + 0.65 * ((ex.targetRow.teamPointPctg ?? 0.5) - 0.5);
      return Math.max(
        0.05,
        Math.min(0.85, params.winsA + params.winsB * (pp - 0.5) + params.winsC * gsax60),
      );
    }
    case "shutouts": {
      // Volume × league finishing — skill SV% injects savePct noise into a
      // near-unpredictable count. Keep structural simple for ranking.
      const gaPg = saPg * (1 - leagueSv);
      return Math.max(0, Math.min(0.3, Math.exp(-gaPg) * params.shutoutCal));
    }
  }
}

// ---------------------------------------------------------------------------
// Marcel-style shrunk rates for goalies

function goalieMarcelRate(
  history: PlayerSeasonRow[],
  target: GoalieV2Target,
  league: GoalieLeagueContext,
  seasonId: number,
): number {
  const eligible = goalieEligible(history).slice(-4);
  if (eligible.length === 0) return NaN;

  if (target === "savePct") {
    // Shrink toward the history-era (lag-1) league mean; goalieEraAdjust then
    // shifts once into the target season. Using trendLevel(target) here would
    // double-count the era move when era-adjust is applied downstream.
    const prior = league.svPct.get(seasonId - 10001) ?? 0.905;
    return shrunkSavePct(eligible, prior);
  }

  // Count rates: decay-weighted with GP-scaled prior.
  const PRIORS: Record<string, { rate: number; games: number }> = {
    wins: { rate: 0.45, games: 25 },
    saves: { rate: 26, games: 10 },
    shutouts: { rate: 0.035, games: 60 },
  };
  const prior = PRIORS[target];
  let num = 0;
  let den = 0;
  let w = 1;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const r = eligible[i];
    num += w * ((r as unknown as Record<string, number>)[target] ?? 0);
    den += w * r.gamesPlayed;
    w *= 0.7;
  }
  return (num + prior.rate * prior.games) / (den + prior.games);
}

function goalieEwma(history: PlayerSeasonRow[], target: GoalieV2Target): number {
  const eligible = goalieEligible(history).slice(-3);
  if (eligible.length === 0) return NaN;
  const w = [0.5, 0.3, 0.2];
  let sum = 0;
  let ws = 0;
  for (let k = 0; k < eligible.length; k++) {
    sum += w[k] * goalieActual(eligible[eligible.length - 1 - k], target);
    ws += w[k];
  }
  return sum / ws;
}

function goalieLag1(history: PlayerSeasonRow[], target: GoalieV2Target): number {
  const eligible = goalieEligible(history);
  if (eligible.length === 0) return NaN;
  return goalieActual(eligible[eligible.length - 1], target);
}

// ---------------------------------------------------------------------------
// Boundary training + walk-forward

export interface GoalieBoundaryModels {
  boundarySeason: number;
  gbdt: Record<string, GbdtModel>;
  ridge: Record<string, RidgeV2>;
  structural: GoalieStructuralParams;
  gbdtGp: GbdtModel;
  ridgeGp: RidgeV2;
}

const GBDT_OPTS: GbdtOptions = {
  nEstimators: 250,
  learningRate: 0.05,
  maxDepth: 3,
  minChildWeight: 8,
  lambda: 1.5,
  subsample: 0.85,
  colsampleByTree: 0.8,
  earlyStoppingRounds: 20,
};

const RIDGE_LAMBDA_G = 80;

export function trainGoalieBoundary(
  examples: GoalieExample[],
  matrix: GoalieMatrix,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
  boundarySeason: number,
  levels: GoalieLevels,
): GoalieBoundaryModels {
  let maxTrainSeason = 0;
  for (const ex of examples) {
    if (ex.seasonId < boundarySeason) maxTrainSeason = Math.max(maxTrainSeason, ex.seasonId);
  }
  const trainIdx: number[] = [];
  const valIdx: number[] = [];
  for (let i = 0; i < examples.length; i++) {
    const s = examples[i].seasonId;
    if (s >= boundarySeason) continue;
    if (s === maxTrainSeason) valIdx.push(i);
    else trainIdx.push(i);
  }

  const nCols = matrix.columns.length;
  const sub = (idx: number[]): Float64Array[] => {
    const cols: Float64Array[] = new Array(nCols);
    for (let j = 0; j < nCols; j++) {
      const col = new Float64Array(idx.length);
      for (let k = 0; k < idx.length; k++) col[k] = matrix.columns[j][idx[k]];
      cols[j] = col;
    }
    return cols;
  };
  const trainCols = sub(trainIdx);
  const valCols = sub(valIdx);

  const gbdt: Record<string, GbdtModel> = {};
  const ridge: Record<string, RidgeV2> = {};

  for (const target of GOALIE_V2_TARGETS) {
    // Targets in era-relative units: models learn skill, not the era; decoding
    // at prediction time re-anchors to the target season's estimated level.
    const yT = new Float64Array(trainIdx.length);
    const wT = new Float64Array(trainIdx.length);
    for (let k = 0; k < trainIdx.length; k++) {
      const ex = examples[trainIdx[k]];
      yT[k] = toRelative(target, goalieActual(ex.actualRow, target), levels, ex.seasonId);
      wT[k] = Math.min(40, ex.actualRow.gamesPlayed) / 40;
    }
    const yV = new Float64Array(valIdx.length);
    const wV = new Float64Array(valIdx.length);
    for (let k = 0; k < valIdx.length; k++) {
      const ex = examples[valIdx[k]];
      yV[k] = toRelative(target, goalieActual(ex.actualRow, target), levels, ex.seasonId);
      wV[k] = Math.min(40, ex.actualRow.gamesPlayed) / 40;
    }
    gbdt[target] = fitGbdt(trainCols, yT, matrix.featureNames, target, wT, GBDT_OPTS, valCols, yV, wV);

    const fitIdx = [...trainIdx, ...valIdx];
    const yF = new Float64Array(fitIdx.length);
    const wF = new Float64Array(fitIdx.length);
    for (let k = 0; k < fitIdx.length; k++) {
      const ex = examples[fitIdx[k]];
      yF[k] = toRelative(target, goalieActual(ex.actualRow, target), levels, ex.seasonId);
      wF[k] = Math.min(40, ex.actualRow.gamesPlayed) / 40;
    }
    ridge[target] = fitRidgeV2(matrix.columns, matrix.featureNames, fitIdx, yF, wF, RIDGE_LAMBDA_G);
  }

  const structural = fitGoalieStructural(
    examples.filter((ex) => ex.seasonId < boundarySeason),
    league,
    registry,
  );

  // GP models
  const yGpT = new Float64Array(trainIdx.length);
  const wGpT = new Float64Array(trainIdx.length);
  for (let k = 0; k < trainIdx.length; k++) {
    yGpT[k] = Math.min(72, gp82(examples[trainIdx[k]].actualRow));
    wGpT[k] = 1;
  }
  const yGpV = new Float64Array(valIdx.length);
  for (let k = 0; k < valIdx.length; k++) {
    yGpV[k] = Math.min(72, gp82(examples[valIdx[k]].actualRow));
  }
  const gbdtGp = fitGbdt(trainCols, yGpT, matrix.featureNames, "gamesPlayed", wGpT, GBDT_OPTS, valCols, yGpV);

  const fitIdx = [...trainIdx, ...valIdx];
  const yGpF = new Float64Array(fitIdx.length);
  const wGpF = new Float64Array(fitIdx.length);
  for (let k = 0; k < fitIdx.length; k++) {
    yGpF[k] = Math.min(72, gp82(examples[fitIdx[k]].actualRow));
    wGpF[k] = 1;
  }
  const ridgeGp = fitRidgeV2(matrix.columns, matrix.featureNames, fitIdx, yGpF, wGpF, RIDGE_LAMBDA_G);

  return { boundarySeason, gbdt, ridge, structural, gbdtGp, ridgeGp };
}

export interface GoalieSignalSet {
  rates: Record<string, Record<GoalieSignal, Float64Array>>;
  gp: Record<"gbdt" | "ridge" | "ewma" | "lag1" | "share", Float64Array>;
}

export function computeGoalieSignals(
  models: GoalieBoundaryModels,
  examples: GoalieExample[],
  exampleRows: number[],
  matrix: GoalieMatrix,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
  levels: GoalieLevels,
): GoalieSignalSet {
  const nCols = matrix.columns.length;
  const cols: Float64Array[] = new Array(nCols);
  for (let j = 0; j < nCols; j++) {
    const col = new Float64Array(exampleRows.length);
    for (let k = 0; k < exampleRows.length; k++) col[k] = matrix.columns[j][exampleRows[k]];
    cols[j] = col;
  }
  const n = exampleRows.length;

  const rates: Record<string, Record<GoalieSignal, Float64Array>> = {};
  for (const target of GOALIE_V2_TARGETS) {
    const set: Record<GoalieSignal, Float64Array> = {
      gbdt: predictGbdtBatch(models.gbdt[target], cols),
      ridge: new Float64Array(n),
      marcel: new Float64Array(n),
      ewma: new Float64Array(n),
      lag1: new Float64Array(n),
      structural: new Float64Array(n),
      market: new Float64Array(n),
    };
    const vec = new Array(nCols);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < nCols; j++) vec[j] = cols[j][k];
      const ex = examples[k];
      set.ridge[k] = clampTarget(
        target,
        fromRelative(target, predictRidgeV2(models.ridge[target], vec), levels, ex.seasonId),
      );
      set.gbdt[k] = clampTarget(
        target,
        fromRelative(target, set.gbdt[k], levels, ex.seasonId),
      );
      const adj = (v: number): number =>
        goalieEraAdjust(target, v, levels, ex.history, ex.seasonId);
      const m = adj(goalieMarcelRate(ex.history, target, league, ex.seasonId));
      set.marcel[k] = Number.isFinite(m) ? m : fallbackRate(target);
      const e = adj(goalieEwma(ex.history, target));
      set.ewma[k] = Number.isFinite(e) ? e : set.marcel[k];
      const l = adj(goalieLag1(ex.history, target));
      set.lag1[k] = Number.isFinite(l) ? l : set.marcel[k];
      set.structural[k] = goalieStructuralSignal(models.structural, ex, target, league, registry);
      // Synthetic market: Marcel/EWMA/lag1 blend (structural is the opportunist anchor).
      set.market[k] =
        0.5 * set.marcel[k] + 0.3 * set.ewma[k] + 0.2 * set.lag1[k];
    }
    rates[target] = set;
  }

  const gp: GoalieSignalSet["gp"] = {
    gbdt: predictGbdtBatch(models.gbdtGp, cols),
    ridge: new Float64Array(n),
    ewma: new Float64Array(n),
    lag1: new Float64Array(n),
    share: new Float64Array(n),
  };
  const vec = new Array(nCols);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < nCols; j++) vec[j] = cols[j][k];
    gp.ridge[k] = Math.max(4, Math.min(72, predictRidgeV2(models.ridgeGp, vec)));
    gp.gbdt[k] = Math.max(4, Math.min(72, gp.gbdt[k]));
    const ex = examples[k];
    const eligible = goalieEligible(ex.history);
    const gps = eligible.slice(-3).map((r) => gp82(r));
    const lag1 = gps.length > 0 ? Math.min(72, gps[gps.length - 1]) : 20;
    const w = [0.5, 0.3, 0.2];
    let ew = 0;
    let ws = 0;
    for (let i = 0; i < gps.length; i++) {
      ew += gps[gps.length - 1 - i] * w[i];
      ws += w[i];
    }
    gp.lag1[k] = lag1;
    gp.ewma[k] = ws > 0 ? Math.min(72, ew / ws) : lag1;
    // Team-share allocation: last season's share of team goalie games × 82.
    const last = eligible.at(-1);
    let share = NaN;
    if (last) {
      const teamGp = league.teamGoalieGp.get(
        `${primaryTeam(last.team)}:${last.seasonId}`,
      );
      if (teamGp && teamGp > 0) share = Math.min(72, (last.gamesPlayed / teamGp) * 82);
    }
    gp.share[k] = Number.isFinite(share) ? share : gp.ewma[k];
  }

  return { rates, gp };
}

function clampTarget(target: GoalieV2Target, v: number): number {
  if (target === "savePct") return Math.max(0.86, Math.min(0.945, v));
  if (target === "wins") return Math.max(0, Math.min(0.85, v));
  if (target === "shutouts") return Math.max(0, Math.min(0.3, v));
  return Math.max(0, v);
}

function fallbackRate(target: GoalieV2Target): number {
  if (target === "savePct") return 0.9;
  if (target === "wins") return 0.4;
  if (target === "shutouts") return 0.03;
  return 25;
}

export interface GoalieSeasonPredictions {
  seasonId: number;
  examples: GoalieExample[];
  signals: GoalieSignalSet;
}

export function runGoalieWalkForward(
  rows: PlayerSeasonRow[],
  evalSeasons: number[],
  onProgress?: (msg: string) => void,
): {
  seasons: GoalieSeasonPredictions[];
  examples: GoalieExample[];
  matrix: GoalieMatrix;
  league: GoalieLeagueContext;
  registry: MoneyPuckGoalieRegistry | null;
  levels: GoalieLevels;
} {
  const registry = loadMoneyPuckRegistrySync();
  const league = buildGoalieLeagueContext(rows);
  const examples = buildGoalieExamples(rows);
  const levels = buildGoalieLevels(rows);
  onProgress?.(
    `goalie walk-forward: ${examples.length} examples, ${GOALIE_V2_FEATURES.length} features, MP registry=${registry ? "yes" : "no"}`,
  );
  const matrix = buildGoalieMatrix(examples, league, registry);

  const bySeason = new Map<number, number[]>();
  for (let i = 0; i < examples.length; i++) {
    const list = bySeason.get(examples[i].seasonId) ?? [];
    list.push(i);
    bySeason.set(examples[i].seasonId, list);
  }

  const seasons: GoalieSeasonPredictions[] = [];
  for (const seasonId of evalSeasons) {
    const exampleRows = bySeason.get(seasonId) ?? [];
    if (exampleRows.length === 0) continue;
    const t0 = Date.now();
    const models = trainGoalieBoundary(examples, matrix, league, registry, seasonId, levels);
    const sigs = computeGoalieSignals(
      models,
      exampleRows.map((i) => examples[i]),
      exampleRows,
      matrix,
      league,
      registry,
      levels,
    );
    onProgress?.(
      `  goalie boundary ${seasonId}: ${exampleRows.length} rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    seasons.push({ seasonId, examples: exampleRows.map((i) => examples[i]), signals: sigs });
  }

  return { seasons, examples, matrix, league, registry, levels };
}

// ---------------------------------------------------------------------------
// Meta fitting

export interface GoalieStackedMetas {
  rateMetas: Record<string, { established: MetaWeights; low: MetaWeights }>;
  gpMeta: { established: MetaWeights; low: MetaWeights };
  /**
   * Per-target leakage-free affine calibrators. Goalie rates (esp. savePct,
   * shutouts, saves) are noise-dominated: the meta keeps too much spread and
   * lands BELOW the mean (negative OOS R²). A monotone affine shrink corrects
   * the scale toward the reliability floor WITHOUT reordering goalies, so the
   * ranking the convex meta protects is preserved exactly. On by default here
   * (unlike skaters) because it recovers real accuracy.
   */
  calibrators?: Partial<Record<string, RateCalibrator>>;
}

/** Smaller K than skaters so goalie calibrators can move off identity. */
const GOALIE_CALIB_K = 80;

/**
 * Only calibrate targets where the monotone affine shrink robustly improves
 * out-of-sample error. savePct and shutouts need a slope floor near their YoY
 * reliability (~0.2–0.3), not the skater floor of 0.5. wins stays raw (already
 * at ceiling).
 */
const GOALIE_CALIBRATE_TARGETS: ReadonlySet<string> = new Set(["savePct", "shutouts"]);

function isLowHistory(ex: GoalieExample): boolean {
  return goalieEligible(ex.history).length <= 2;
}

const GOALIE_GP_SIGNALS = ["gbdt", "ridge", "ewma", "lag1", "structural"] as const;

/**
 * Signals allowed per target. Shutouts / savePct are noise-dominated: ewma,
 * lag1, and the synthetic market (which re-injects them) have negative OOS R²
 * and only give the meta more ways to over-disperse. Saves keep volume models
 * only — skill luck belongs in savePct.
 */
const GOALIE_TARGET_SIGNALS: Record<GoalieV2Target, readonly GoalieSignal[]> = {
  wins: ["gbdt", "ridge", "marcel", "ewma", "lag1", "structural", "market"],
  saves: ["gbdt", "ridge", "marcel", "structural"],
  shutouts: ["gbdt", "marcel", "structural"],
  // Structural (GSAx) + Marcel only; convex meta preserves elite/weak order.
  savePct: ["structural", "marcel"],
};

function goalieSignalRow(
  target: GoalieV2Target,
  sig: Record<GoalieSignal, Float64Array>,
  k: number,
): number[] {
  return GOALIE_TARGET_SIGNALS[target].map((s) => sig[s][k]);
}

/**
 * Leakage-free per-target affine calibrators for goalie rates. Expanding-window
 * meta walk-forward INSIDE the pool (metas for season s fit on pool seasons < s,
 * uncalibrated predictions), so `testSeason` is never seen.
 */
export function fitGoalieCalibrators(
  pool: GoalieSeasonPredictions[],
  disagreementSigma = DISAGREEMENT_SIGMA,
): Partial<Record<string, RateCalibrator>> {
  const ordered = [...pool].sort((x, y) => x.seasonId - y.seasonId);
  const acc: Record<string, { p: number[]; a: number[]; w: number[] }> = {};
  for (const t of GOALIE_V2_TARGETS) acc[t] = { p: [], a: [], w: [] };
  for (let si = 1; si < ordered.length; si++) {
    const past = ordered.slice(0, si);
    const cur = ordered[si];
    const metas = fitGoalieMetas(past, cur.seasonId, disagreementSigma, false);
    for (const t of GOALIE_V2_TARGETS) {
      const sig = cur.signals.rates[t];
      for (let k = 0; k < cur.examples.length; k++) {
        const ex = cur.examples[k];
        const low = isLowHistory(ex);
        acc[t].p.push(goalieMetaRate(metas, t, sig, k, low, false));
        acc[t].a.push(goalieActual(ex.actualRow, t));
        acc[t].w.push(Math.min(40, ex.actualRow.gamesPlayed) / 40);
      }
    }
  }
  const out: Partial<Record<string, RateCalibrator>> = {};
  for (const t of GOALIE_V2_TARGETS) {
    if (!GOALIE_CALIBRATE_TARGETS.has(t)) continue; // others stay raw (no-op)
    out[t] = fitAffineCalibrator(acc[t].p, acc[t].a, acc[t].w, GOALIE_CALIB_K, 0.15);
  }
  return out;
}

export function fitGoalieMetas(
  pool: GoalieSeasonPredictions[],
  testSeason: number,
  disagreementSigma = DISAGREEMENT_SIGMA,
  withCalibrators = true,
): GoalieStackedMetas {
  const rateMetas: GoalieStackedMetas["rateMetas"] = {};
  const useMarket = marketTrainingEnabled();

  for (const target of GOALIE_V2_TARGETS) {
    const Xe: number[][] = [];
    const ye: number[] = [];
    const we: number[] = [];
    const Xl: number[][] = [];
    const yl: number[] = [];
    const wl: number[] = [];

    const allActual: number[] = [];
    for (const season of pool) {
      for (let k = 0; k < season.examples.length; k++) {
        allActual.push(goalieActual(season.examples[k].actualRow, target));
      }
    }
    const statSd = sampleStd(allActual);

    for (const season of pool) {
      const recency = Math.exp(-0.15 * ((testSeason - season.seasonId) / 10001));
      const sig = season.signals.rates[target];
      for (let k = 0; k < season.examples.length; k++) {
        const ex = season.examples[k];
        const row = goalieSignalRow(target, sig, k);
        const y = goalieActual(ex.actualRow, target);
        let w = (Math.min(40, ex.actualRow.gamesPlayed) / 40) * recency;
        if (
          useMarket &&
          sig.market &&
          GOALIE_TARGET_SIGNALS[target].includes("market")
        ) {
          const mkt = sig.market[k];
          const opp = sig.structural?.[k] ?? 0.5 * (sig.gbdt[k] + sig.marcel[k]);
          w *= disagreementWeight(mkt, opp, statSd, disagreementSigma);
        }
        if (isLowHistory(ex)) {
          Xl.push(row);
          yl.push(y);
          wl.push(w);
        } else {
          Xe.push(row);
          ye.push(y);
          we.push(w);
        }
      }
    }
    const sigs = GOALIE_TARGET_SIGNALS[target];
    // savePct: convex meta (weights sum to 1, no intercept) so elite/weak
    // goalies keep differentiated projections instead of collapsing to ~.895.
    const fit = target === "savePct" ? fitMetaConvex : fitMetaNnls;
    rateMetas[target] = {
      established: fit(Xe, ye, we, sigs),
      low: fit(Xl, yl, wl, sigs),
    };
  }

  const Xe: number[][] = [];
  const ye: number[] = [];
  const we: number[] = [];
  const Xl: number[][] = [];
  const yl: number[] = [];
  const wl: number[] = [];
  for (const season of pool) {
    const recency = Math.exp(-0.15 * ((testSeason - season.seasonId) / 10001));
    const gp = season.signals.gp;
    for (let k = 0; k < season.examples.length; k++) {
      const ex = season.examples[k];
      const row = [gp.gbdt[k], gp.ridge[k], gp.ewma[k], gp.lag1[k], gp.share[k]];
      const y = Math.min(72, gp82(ex.actualRow));
      if (isLowHistory(ex)) {
        Xl.push(row);
        yl.push(y);
        wl.push(recency);
      } else {
        Xe.push(row);
        ye.push(y);
        we.push(recency);
      }
    }
  }

  const metas: GoalieStackedMetas = {
    rateMetas,
    gpMeta: {
      established: fitMetaNnls(Xe, ye, we, GOALIE_GP_SIGNALS),
      low: fitMetaNnls(Xl, yl, wl, GOALIE_GP_SIGNALS),
    },
  };
  if (withCalibrators) {
    metas.calibrators = fitGoalieCalibrators(pool, disagreementSigma);
  }
  return metas;
}

export function goalieMetaRate(
  metas: GoalieStackedMetas,
  target: GoalieV2Target,
  sig: Record<GoalieSignal, Float64Array>,
  k: number,
  low: boolean,
  useCalibrator = true,
): number {
  const meta = low ? metas.rateMetas[target].low : metas.rateMetas[target].established;
  const raw = applyMeta(meta, goalieSignalRow(target, sig, k));
  const cal = useCalibrator ? applyRateCalibrator(metas.calibrators?.[target], raw) : raw;
  return clampTarget(target, cal);
}

export function goalieMetaGp(
  metas: GoalieStackedMetas,
  gp: GoalieSignalSet["gp"],
  k: number,
  low: boolean,
): number {
  const meta = low ? metas.gpMeta.low : metas.gpMeta.established;
  const row = [gp.gbdt[k], gp.ridge[k], gp.ewma[k], gp.lag1[k], gp.share[k]];
  return Math.max(4, Math.min(72, applyMeta(meta, row)));
}

// ---------------------------------------------------------------------------
// Single-player inference (production path)

export interface GoalieV2Models {
  gbdt: Record<string, GbdtModel>;
  ridge: Record<string, RidgeV2>;
  structural: GoalieStructuralParams;
  gbdtGp: GbdtModel;
  ridgeGp: RidgeV2;
}

export function inferGoalieForPlayer(
  models: GoalieV2Models,
  metas: GoalieStackedMetas,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
  levels: GoalieLevels,
): { rates: Record<GoalieV2Target, number>; gamesPlayed: number } | null {
  const eligible = goalieEligible(history);
  if (eligible.length === 0) return null;
  const low = eligible.length <= 2;

  const vec = goalieFeatureVector(history, targetRow, league, registry);
  const ex = { history, targetRow, seasonId: targetRow.seasonId };

  const rates = {} as Record<GoalieV2Target, number>;
  for (const target of GOALIE_V2_TARGETS) {
    const adj = (v: number): number =>
      goalieEraAdjust(target, v, levels, history, targetRow.seasonId);
    const m = adj(goalieMarcelRate(history, target, league, targetRow.seasonId));
    const marcel = Number.isFinite(m) ? m : fallbackRate(target);
    const e = adj(goalieEwma(history, target));
    const l = adj(goalieLag1(history, target));
    const bySignal: Record<GoalieSignal, number> = {
      gbdt: clampTarget(
        target,
        fromRelative(target, predictGbdt(models.gbdt[target], vec), levels, targetRow.seasonId),
      ),
      ridge: clampTarget(
        target,
        fromRelative(target, predictRidgeV2(models.ridge[target], vec), levels, targetRow.seasonId),
      ),
      marcel,
      ewma: Number.isFinite(e) ? e : marcel,
      lag1: Number.isFinite(l) ? l : marcel,
      structural: goalieStructuralSignal(models.structural, ex, target, league, registry),
      market: 0,
    };
    bySignal.market =
      0.5 * bySignal.marcel + 0.3 * bySignal.ewma + 0.2 * bySignal.lag1;
    const meta = low ? metas.rateMetas[target].low : metas.rateMetas[target].established;
    // Legacy metas omit "market" — only pass signals the meta was fit on.
    const sigNames = meta.signals.length > 0 ? meta.signals : [...GOALIE_TARGET_SIGNALS[target]];
    const signalRow = sigNames.map((s) => bySignal[s as GoalieSignal] ?? 0);
    const raw = applyMeta(meta, signalRow);
    rates[target] = clampTarget(
      target,
      applyRateCalibrator(metas.calibrators?.[target], raw),
    );
  }

  // GP signals
  const gps = eligible.slice(-3).map((r) => gp82(r));
  const lag1 = gps.length > 0 ? Math.min(72, gps[gps.length - 1]) : 20;
  const w = [0.5, 0.3, 0.2];
  let ew = 0;
  let ws = 0;
  for (let i = 0; i < gps.length; i++) {
    ew += gps[gps.length - 1 - i] * w[i];
    ws += w[i];
  }
  const ewma = ws > 0 ? Math.min(72, ew / ws) : lag1;
  const last = eligible.at(-1);
  let share = ewma;
  if (last) {
    const teamGp = league.teamGoalieGp.get(`${primaryTeam(last.team)}:${last.seasonId}`);
    if (teamGp && teamGp > 0) share = Math.min(72, (last.gamesPlayed / teamGp) * 82);
  }
  const gpRow = [
    Math.max(4, Math.min(72, predictGbdt(models.gbdtGp, vec))),
    Math.max(4, Math.min(72, predictRidgeV2(models.ridgeGp, vec))),
    ewma,
    lag1,
    share,
  ];
  const gpMeta = low ? metas.gpMeta.low : metas.gpMeta.established;
  const gamesPlayed = Math.max(4, Math.min(72, applyMeta(gpMeta, gpRow)));

  return { rates, gamesPlayed };
}
