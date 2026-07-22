/**
 * Goalie projection v2 — factorized + pruned + role-split.
 *
 * Models learn intermediates that persist, then fantasy rates are derived:
 *  - savePct → quality residual (xSV − xExpected / SV − league)
 *  - saves   → SA/gp × SV%
 *  - wins    → team strength × role (+ tiny GSAx)
 *  - shutouts → Poisson(SA × GA%)
 *  - GP      → stack + tandem renormalization (~82 team GP)
 *
 * Training uses OOS-selected ~56 features (170 candidates) and separate
 * starter vs backup meta weights.
 */

import { fitGbdt, predictGbdt, predictGbdtBatch, type GbdtModel, type GbdtOptions } from "./gbdt";
import { fitMlp, predictMlp, predictMlpBatch, type MlpModel, type MlpOptions } from "./mlp";
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
  hdSvResidual,
  reboundRateDelta,
  freezeRateDelta,
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
  "mlp",
  "marcel",
  "ewma",
  "lag1",
  "structural",
  "factor",
  "market",
] as const;
export type GoalieSignal = (typeof GOALIE_SIGNALS)[number];

/** Max features kept after walk-forward univariate screen. */
let GOALIE_FEATURE_BUDGET = 52;

/** Tunable heuristics — sweep via `setGoalieHeuristics` / iterate script. */
export interface GoalieHeuristics {
  featureBudget: number;
  tandemGpTarget: number;
  shareBlend: number;
  teamWinsBlend: number;
  /** Shrink same-team saves/gp toward team mean (0 = off). */
  savesTeamBlend: number;
  ageGp: boolean;
  dropMlpWins: boolean;
  /** Starters: factor/structural/marcel only for saves (trees hurt rate R²). */
  savesStructuralOnly: boolean;
}

const DEFAULT_HEURISTICS: GoalieHeuristics = {
  featureBudget: 52,
  tandemGpTarget: 80,
  shareBlend: 0,
  teamWinsBlend: 0,
  savesTeamBlend: 0,
  ageGp: false,
  dropMlpWins: false,
  savesStructuralOnly: false,
};

let HEURISTICS: GoalieHeuristics = { ...DEFAULT_HEURISTICS };

export function setGoalieHeuristics(partial: Partial<GoalieHeuristics>): GoalieHeuristics {
  HEURISTICS = { ...HEURISTICS, ...partial };
  GOALIE_FEATURE_BUDGET = HEURISTICS.featureBudget;
  return { ...HEURISTICS };
}

export function getGoalieHeuristics(): GoalieHeuristics {
  return { ...HEURISTICS };
}

export function resetGoalieHeuristics(): void {
  HEURISTICS = { ...DEFAULT_HEURISTICS };
  GOALIE_FEATURE_BUDGET = HEURISTICS.featureBudget;
}

/** Always retain these when present — role, skill, team, injury core. */
const GOALIE_ANCHOR_FEATURES = new Set([
  "gp82_lag1",
  "gp82_ewma",
  "team_share_lag1",
  "team_share_ewma",
  "career_gp",
  "prior_seasons",
  "inj8_82_lag1",
  "chronic_inj8",
  "b2b_gp_cap",
  "age",
  "age_sq",
  "wins_pg_lag1",
  "saves_pg_lag1",
  "savePct_lag1",
  "gs_pg_lag1",
  "sa_pg_lag1",
  "start_share_lag1",
  "gsax60_lag1",
  "xsvpct_delta_lag1",
  "hd_sv_delta_lag1",
  "five_gsax60_lag1",
  "workload_sa60_lag1",
  "sv_shrunk",
  "gsax60_shrunk",
  "hd_sv_shrunk",
  "team_ga_pg",
  "team_gf_pg",
  "team_point_pct",
  "team_elo",
  "team_sa_pg",
  "team_xsv",
  "team_pk_ga60",
  "team_diff_pg",
  "depth_rank",
  "is_starter",
  "league_svpct",
  "cap_hit_m",
]);

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
  "career_starts",
  "starter_seasons",
  "gp_volatility",
  // Game-log durability. Goalies sit as healthy backups, so absence is only
  // an injury signal for long gaps (8+ team games) — starters never sit that
  // long by rotation alone.
  "inj8_82_lag1",
  "inj8_82_ewma",
  "spells8_lag1",
  "longest_gap_lag1",
  "tail82_lag1",
  "chronic_inj8",
  "inj3_82_lag1",
  "scratch82_lag1",
  "head82_lag1",
  "late_miss_lag1",
  "late_avail_lag1",
  // Ironman + back-to-back workload (starters rarely play both B2B nights)
  "streak_lag1",
  "full_season_lag1",
  "team_b2b_lag1",
  "b2b_gp_cap",
  // Bio / draft / contract
  "age",
  "age_sq",
  "age_over_35",
  "height_in",
  "weight_lb",
  "bmi",
  "shoots_left",
  "draft_overall",
  "draft_round",
  "years_since_draft",
  "undrafted",
  "cap_hit_m",
  "years_remaining",
  "walk_year",
  // Fantasy + NHL summary history
  ...lagNames("wins_pg"),
  ...lagNames("saves_pg"),
  ...lagNames("shutouts_pg"),
  ...lagNames("savePct"),
  ...lagNames("gs_pg"),
  ...lagNames("start_share"),
  ...lagNames("sa_pg"),
  ...lagNames("toi_pg"),
  ...lagNames("gaa"),
  ...lagNames("win_pct"),
  // MoneyPuck skill / volume / process
  ...lagNames("gsax60"),
  ...lagNames("xsvpct_delta"),
  ...lagNames("workload_sa60"),
  ...lagNames("hd_sv_delta"),
  ...lagNames("hd_shot_share"),
  ...lagNames("rebound_delta"),
  ...lagNames("freeze_delta"),
  ...lagNames("flurry_gsax60"),
  ...lagNames("unblocked_sa60"),
  ...lagNames("five_gsax60"),
  ...lagNames("five_hd_sv_delta"),
  "sv_shrunk",
  "gsax60_shrunk",
  "hd_sv_shrunk",
  // Team / era / coach / depth
  "team_ga_pg",
  "team_gf_pg",
  "team_diff_pg",
  "team_point_pct",
  "team_rank",
  "team_elo",
  "team_hits_pg",
  "team_pim_pg",
  "team_blocks_pg",
  "team_pp_share",
  "team_pk_ga60",
  "team_sa_pg",
  "team_xsv",
  "team_changed",
  "coach_tenure",
  "depth_rank",
  "is_starter",
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
  /** `${team}:${seasonId}` → MoneyPuck expected SV% (1 − xGA/SOG). */
  teamXsv: Map<string, number>;
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
 * Model training spaces (what GBDT/ridge optimize):
 *  - savePct → quality residual (not raw SV%)
 *  - saves   → SA/gp (workload), decoded to saves via league SV%
 *  - wins/shutouts → per-game rates as before
 */
function actualSaPg(row: PlayerSeasonRow): number {
  if (row.gamesPlayed <= 0 || row.saves <= 0) return NaN;
  const sv = row.savePct > 1 ? row.savePct / 100 : row.savePct;
  if (!(sv > 0 && sv < 1)) return NaN;
  return row.saves / sv / row.gamesPlayed;
}

function actualShotsFaced(row: PlayerSeasonRow): number {
  const sv = row.savePct > 1 ? row.savePct / 100 : row.savePct;
  if (!(sv > 0 && sv < 1) || row.saves <= 0) return 0;
  return row.saves / sv;
}

/** Train label for GBDT/ridge (model space). */
function modelTrainY(
  target: GoalieV2Target,
  actual: PlayerSeasonRow,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
  levels: GoalieLevels,
): number {
  if (target === "savePct") {
    const mp = lookupMoneyPuckGoalieSeason(registry, actual.playerId, actual.seasonId);
    if (mp && mp.shotsOnGoalAgainst >= 200) {
      const act = 1 - mp.goalsAgainst / mp.shotsOnGoalAgainst;
      const exp = 1 - mp.xGoalsAgainst / mp.shotsOnGoalAgainst;
      return act - exp; // xSV% residual — more persistent than raw SV%
    }
    const sv = goalieActual(actual, "savePct");
    const leagueSv = knownLevel(levels.savePct, actual.seasonId);
    return Number.isFinite(leagueSv) ? sv - leagueSv : sv - 0.905;
  }
  if (target === "saves") {
    const sa = actualSaPg(actual);
    const leagueSa = league.saPerGame.get(actual.seasonId) ?? 30;
    return Number.isFinite(sa) && leagueSa > 0 ? sa / leagueSa : 1;
  }
  return toRelativeRate(target, goalieActual(actual, target), levels, actual.seasonId);
}

/** Decode GBDT/ridge output into the fantasy rate the meta expects. */
function modelDecodeY(
  target: GoalieV2Target,
  pred: number,
  seasonId: number,
  league: GoalieLeagueContext,
  levels: GoalieLevels,
): number {
  if (target === "savePct") {
    const leagueSv = trendLevel(league.svPct, seasonId, 0.905);
    // Residual is tiny; clamp skill delta hard (±1.5 pts SV%).
    const delta = Math.max(-0.015, Math.min(0.015, pred));
    return clampTarget("savePct", leagueSv + delta);
  }
  if (target === "saves") {
    const leagueSa = trendLevel(league.saPerGame, seasonId, 30);
    const leagueSv = trendLevel(league.svPct, seasonId, 0.905);
    const saPg = Math.max(18, Math.min(40, pred * leagueSa));
    return Math.max(0, saPg * leagueSv);
  }
  return clampTarget(target, fromRelativeRate(target, pred, levels, seasonId));
}

function toRelativeRate(
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

function fromRelativeRate(
  target: GoalieV2Target,
  rel: number,
  levels: GoalieLevels,
  seasonId: number,
): number {
  if (target === "saves") {
    const lvl = levelEstimate(levels.saves, seasonId);
    return Number.isFinite(lvl) && lvl > 0 ? rel * lvl : rel * 28;
  }
  if (target === "savePct") {
    const lvl = levelEstimate(levels.savePct, seasonId);
    return Number.isFinite(lvl) ? rel + lvl : rel + 0.905;
  }
  return rel;
}

/** Shot-faced sample weight — SV%/volume labels are noise unless heavily shot-weighted. */
function goalieSampleWeight(row: PlayerSeasonRow, target: GoalieV2Target): number {
  const gpW = Math.min(40, row.gamesPlayed) / 40;
  if (target === "savePct" || target === "saves") {
    const shots = actualShotsFaced(row);
    const shotW = Math.min(1, Math.sqrt(Math.max(0, shots) / 1200));
    return Math.max(0.05, gpW * shotW);
  }
  return Math.max(0.05, gpW);
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

export function buildGoalieLeagueContext(
  rows: PlayerSeasonRow[],
  registry: MoneyPuckGoalieRegistry | null = null,
): GoalieLeagueContext {
  const svPct = new Map<number, number>();
  const saPerGame = new Map<number, number>();
  const teamSaPerGame = new Map<string, number>();
  const teamGoalieGp = new Map<string, number>();
  const teamXsv = new Map<string, number>();

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

  // Team expected SV% from MoneyPuck xGA / SOG (shot-quality environment).
  if (registry) {
    const agg = new Map<string, { xga: number; sog: number }>();
    for (const mp of Object.values(registry.byKey)) {
      if (mp.shotsOnGoalAgainst < 50) continue;
      const team = primaryTeam(mp.team);
      if (!team) continue;
      const key = `${team}:${mp.seasonId}`;
      const cur = agg.get(key) ?? { xga: 0, sog: 0 };
      cur.xga += mp.xGoalsAgainst;
      cur.sog += mp.shotsOnGoalAgainst;
      agg.set(key, cur);
    }
    for (const [key, v] of agg) {
      if (v.sog >= 400) teamXsv.set(key, 1 - v.xga / v.sog);
    }
  }

  return { svPct, saPerGame, teamSaPerGame, teamGoalieGp, teamXsv };
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
  hdSvDelta: number;
  hdShotShare: number;
  reboundDelta: number;
  freezeDelta: number;
  flurryGsax60: number;
  unblockedSa60: number;
  fiveGsax60: number;
  fiveHdSvDelta: number;
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
  const totalShots =
    mp.lowDangerShots + mp.mediumDangerShots + mp.highDangerShots;
  const hdShotShare = totalShots > 0 ? mp.highDangerShots / totalShots : NaN;
  const flurryGsax =
    mp.flurryAdjustedxGoals > 0
      ? ((mp.flurryAdjustedxGoals - mp.goalsAgainst) / minutes) * 60
      : NaN;
  const unblockedSa60 =
    mp.unblockedShotAttempts > 0 ? (mp.unblockedShotAttempts / minutes) * 60 : NaN;

  let fiveGsax60 = NaN;
  let fiveHdSvDelta = NaN;
  if (mp.fiveOn5 && mp.fiveOn5.icetimeSeconds > 0) {
    const m5 = mp.fiveOn5.icetimeSeconds / 60;
    fiveGsax60 =
      ((mp.fiveOn5.xGoalsAgainst - mp.fiveOn5.goalsAgainst) / m5) * 60;
    if (mp.fiveOn5.highDangerShots >= 25 && mp.fiveOn5.highDangerxGoals > 0) {
      const act = 1 - mp.fiveOn5.highDangerGoals / mp.fiveOn5.highDangerShots;
      const exp = 1 - mp.fiveOn5.highDangerxGoals / mp.fiveOn5.highDangerShots;
      fiveHdSvDelta = act - exp;
    }
  }

  return {
    gsax60,
    xsvpctDelta: actualSv - expectedSv,
    sa60,
    hdSvDelta: hdSvResidual(mp),
    hdShotShare,
    reboundDelta: reboundRateDelta(mp),
    freezeDelta: freezeRateDelta(mp),
    flurryGsax60: flurryGsax,
    unblockedSa60,
    fiveGsax60,
    fiveHdSvDelta,
  };
}

/** Shots against per game from NHL field or derived from saves/SV%. */
function rowSaPg(r: PlayerSeasonRow): number {
  if (r.gamesPlayed <= 0) return NaN;
  if (r.shotsAgainst != null && r.shotsAgainst > 0) return r.shotsAgainst / r.gamesPlayed;
  const sv = r.savePct > 1 ? r.savePct / 100 : r.savePct;
  if (sv > 0 && sv < 1 && r.saves > 0) return r.saves / sv / r.gamesPlayed;
  return NaN;
}

function rowStartShare(r: PlayerSeasonRow, league: GoalieLeagueContext): number {
  const gs = r.gamesStarted;
  if (gs != null && gs > 0 && r.gamesPlayed > 0) {
    // Starts as share of appearances when GS known; else fall back to team GP share.
    return Math.min(1, gs / Math.max(r.gamesPlayed, gs));
  }
  const teamGp = league.teamGoalieGp.get(`${primaryTeam(r.team)}:${r.seasonId}`);
  return teamGp && teamGp > 0 ? r.gamesPlayed / teamGp : NaN;
}

function rowGaa(r: PlayerSeasonRow): number {
  if (r.goalsAgainstAverage != null && r.goalsAgainstAverage > 0) return r.goalsAgainstAverage;
  if (r.gamesPlayed <= 0) return NaN;
  if (r.goalsAgainst != null && r.goalsAgainst >= 0) {
    return (r.goalsAgainst * 60) / Math.max(1, (r.timeOnIceSeconds ?? r.gamesPlayed * 3600) / 60);
  }
  const sa = rowSaPg(r);
  const sv = r.savePct > 1 ? r.savePct / 100 : r.savePct;
  if (Number.isFinite(sa) && sv > 0 && sv < 1) return sa * (1 - sv);
  return NaN;
}

function shrunkHdSv(
  eligible: PlayerSeasonRow[],
  registry: MoneyPuckGoalieRegistry | null,
): number {
  let num = 0;
  let den = 0;
  let w = 1;
  for (let i = eligible.length - 1; i >= 0; i--) {
    const mp = lookupMoneyPuckGoalieSeason(registry, eligible[i].playerId, eligible[i].seasonId);
    if (mp) {
      const d = hdSvResidual(mp);
      if (Number.isFinite(d) && mp.highDangerShots > 0) {
        num += w * d * mp.highDangerShots;
        den += w * mp.highDangerShots;
      }
    }
    w *= 0.8;
  }
  if (den <= 0) return 0;
  const raw = num / den;
  return raw * (den / (den + 400));
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

/**
 * EB-shrunk career save%. Prior ≈ 3000 shots matches published GSAx regression
 * constants — YoY skill is tiny, so almost everyone sits near league mean.
 */
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
  const PRIOR_SHOTS = 3000;
  return (saves + PRIOR_SHOTS * leagueMean) / Math.max(1, shots + PRIOR_SHOTS);
}

/** EB-shrunk GSAx/60 (decay 0.8, prior 2000 minutes at 0). */
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
  return rate * (minutes / (minutes + 2000));
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
  out.push(eligible.reduce((s, r) => s + (r.gamesStarted ?? 0), 0));
  out.push(eligible.filter((r) => r.gamesPlayed >= 40).length);
  {
    const gps = eligible.map((r) => gp82(r)).filter((v) => Number.isFinite(v));
    if (gps.length >= 2) {
      const m = gps.reduce((a, b) => a + b, 0) / gps.length;
      const v = gps.reduce((s, x) => s + (x - m) ** 2, 0) / gps.length;
      out.push(Math.sqrt(v) / Math.max(1, m));
    } else {
      out.push(NaN);
    }
  }

  // Game-log durability (full history; 8+ game gaps = goalie injury proxy)
  const inj8Per82 = (r: PlayerSeasonRow): number =>
    r.dur && r.dur.teamGames > 0
      ? ((r.dur.inj8 + r.dur.tail) * 82) / r.dur.teamGames
      : NaN;
  const inj3Per82 = (r: PlayerSeasonRow): number =>
    r.dur && r.dur.teamGames > 0 ? (r.dur.inj * 82) / r.dur.teamGames : NaN;
  const scratch82 = (r: PlayerSeasonRow): number =>
    r.dur && r.dur.teamGames > 0 ? (r.dur.scratch * 82) / r.dur.teamGames : NaN;
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
  const lastHist = history.at(-1);
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
  out.push(lastHist ? inj3Per82(lastHist) : NaN);
  out.push(lastHist ? scratch82(lastHist) : NaN);
  out.push(
    lastDur && lastDur.teamGames > 0 ? lastDur.head / lastDur.teamGames : NaN,
  );
  out.push(
    lastDur && lastDur.window > 0 ? lastDur.lateMiss / lastDur.window : NaN,
  );
  out.push(
    lastDur && lastDur.window > 0 ? lastDur.latePlayed / lastDur.window : NaN,
  );

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
  out.push(Number.isFinite(age) && age >= 35 ? 1 : Number.isFinite(age) ? 0 : NaN);
  out.push(target.heightInches ?? NaN);
  out.push(target.weightPounds ?? NaN);
  out.push(
    target.heightInches && target.weightPounds && target.heightInches > 0
      ? (target.weightPounds / (target.heightInches * target.heightInches)) * 703
      : NaN,
  );
  out.push(
    target.shootsLeft === 1 || target.shootsLeft === 0 ? target.shootsLeft : NaN,
  );
  out.push(
    target.draftOverallPick && target.draftOverallPick > 0 ? target.draftOverallPick : NaN,
  );
  out.push(target.draftRound && target.draftRound > 0 ? target.draftRound : NaN);
  {
    const draftYear = target.draftYear ?? 0;
    const seasonYear = Math.floor(target.seasonId / 10000);
    out.push(draftYear > 0 ? Math.max(0, seasonYear - draftYear) : NaN);
    out.push(draftYear > 0 || (target.draftOverallPick ?? 0) > 0 ? 0 : 1);
  }
  out.push(
    target.capHitUsd && target.capHitUsd > 0 ? target.capHitUsd / 1_000_000 : NaN,
  );
  out.push(
    target.contractYearsRemaining != null && target.contractYearsRemaining > 0
      ? target.contractYearsRemaining
      : NaN,
  );
  out.push(
    target.contractYearsRemaining === 1
      ? 1
      : target.contractYearsRemaining != null && target.contractYearsRemaining > 1
        ? 0
        : NaN,
  );

  pushLags(out, eligible.map((r) => goalieActual(r, "wins")));
  pushLags(out, eligible.map((r) => goalieActual(r, "saves")));
  pushLags(out, eligible.map((r) => goalieActual(r, "shutouts")));
  pushLags(out, eligible.map((r) => goalieActual(r, "savePct")));
  pushLags(
    out,
    eligible.map((r) =>
      r.gamesPlayed > 0 && r.gamesStarted != null ? r.gamesStarted / r.gamesPlayed : NaN,
    ),
  );
  pushLags(
    out,
    eligible.map((r) => rowStartShare(r, league)),
  );
  pushLags(out, eligible.map((r) => rowSaPg(r)));
  pushLags(
    out,
    eligible.map((r) =>
      r.timeOnIceSeconds && r.gamesPlayed > 0
        ? r.timeOnIceSeconds / 60 / r.gamesPlayed
        : NaN,
    ),
  );
  pushLags(out, eligible.map((r) => rowGaa(r)));
  pushLags(
    out,
    eligible.map((r) =>
      r.gamesPlayed > 0 ? r.wins / r.gamesPlayed : NaN,
    ),
  );

  const mpVals = eligible.map((r) => mpDerived(registry, r));
  pushLags(out, mpVals.map((m) => m?.gsax60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.xsvpctDelta ?? NaN));
  pushLags(out, mpVals.map((m) => m?.sa60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.hdSvDelta ?? NaN));
  pushLags(out, mpVals.map((m) => m?.hdShotShare ?? NaN));
  pushLags(out, mpVals.map((m) => m?.reboundDelta ?? NaN));
  pushLags(out, mpVals.map((m) => m?.freezeDelta ?? NaN));
  pushLags(out, mpVals.map((m) => m?.flurryGsax60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.unblockedSa60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.fiveGsax60 ?? NaN));
  pushLags(out, mpVals.map((m) => m?.fiveHdSvDelta ?? NaN));

  const leagueSv = league.svPct.get(prevSeason) ?? 0.905;
  out.push(shrunkSavePct(eligible, leagueSv));
  out.push(shrunkGsax60(eligible, registry));
  out.push(shrunkHdSv(eligible, registry));

  out.push(target.teamGoalsAgainstPerGame ?? NaN);
  out.push(target.teamGoalsForPerGame ?? NaN);
  out.push(target.teamGoalDiffPerGame ?? NaN);
  out.push(target.teamPointPctg ?? NaN);
  out.push(target.teamLeagueRank ?? NaN);
  out.push(target.teamElo != null ? target.teamElo / 1000 : NaN);
  out.push(target.teamHitsPerGame ?? NaN);
  out.push(target.teamPimPerGame ?? NaN);
  out.push(target.teamBlocksPerGame ?? NaN);
  out.push(target.teamPpGoalShare ?? NaN);
  out.push(target.teamPkGaPer60 ?? NaN);
  const targetTeam = primaryTeam(target.team);
  out.push(league.teamSaPerGame.get(`${targetTeam}:${prevSeason}`) ?? NaN);
  out.push(league.teamXsv.get(`${targetTeam}:${prevSeason}`) ?? NaN);
  const lastTeam =
    history.length > 0 ? primaryTeam(history[history.length - 1].team) : "";
  out.push(lastTeam && targetTeam ? (lastTeam === targetTeam ? 0 : 1) : NaN);
  out.push(target.coachTenureSeasons ?? NaN);

  // Depth among team goalies last season (by GP share).
  {
    const last = eligible.at(-1);
    if (last) {
      const team = primaryTeam(last.team);
      const teamGp = league.teamGoalieGp.get(`${team}:${last.seasonId}`) ?? 0;
      const share = teamGp > 0 ? last.gamesPlayed / teamGp : NaN;
      // Approximate rank: 1 if share≥0.55, 2 if ≥0.25, else 3.
      const depthRank = Number.isFinite(share)
        ? share >= 0.55
          ? 1
          : share >= 0.25
            ? 2
            : 3
        : NaN;
      out.push(depthRank);
      out.push(Number.isFinite(share) ? (share >= 0.55 ? 1 : 0) : NaN);
    } else {
      out.push(NaN, NaN);
    }
  }
  out.push(leagueSv);

  if (out.length !== GOALIE_V2_FEATURES.length) {
    throw new Error(
      `goalie feature length mismatch: got ${out.length}, expected ${GOALIE_V2_FEATURES.length}`,
    );
  }
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

  // Shutout calibration: SA × skill-tilted GA rate (matches prediction).
  let poisSum = 0;
  let actSum = 0;
  let n = 0;
  for (const ex of trainExamples) {
    if (ex.actualRow.gamesPlayed < 15) continue;
    const eligible = goalieEligible(ex.history);
    if (eligible.length === 0) continue;
    const { sv, saPg } = goalieWorkloadContext(ex, league);
    const gaPg = saPg * (1 - sv);
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
  const last = eligible.at(-1);
  let startShare = 0.5;
  if (last) {
    const teamGp = league.teamGoalieGp.get(`${primaryTeam(last.team)}:${last.seasonId}`);
    if (teamGp && teamGp > 0) startShare = last.gamesPlayed / teamGp;
    else if (last.gamesStarted != null && last.gamesPlayed > 0) {
      startShare = Math.min(1, last.gamesStarted / Math.max(last.gamesPlayed, last.gamesStarted));
    }
  }

  switch (target) {
    case "savePct": {
      const prevSeason = ex.seasonId - 10001;
      const teamXsv =
        league.teamXsv.get(`${primaryTeam(ex.targetRow.team)}:${prevSeason}`) ?? leagueSv;
      const skillTilt = saPg > 0 ? gsax60 / saPg : 0;
      const careerTilt = sv - leagueSv;
      const blended =
        0.55 * leagueSv + 0.3 * teamXsv + 0.1 * (leagueSv + careerTilt) + 0.05 * (leagueSv + skillTilt);
      return Math.max(0.885, Math.min(0.925, blended));
    }
    case "saves":
      return Math.max(0, saPg * leagueSv);
    case "wins": {
      // Wins/gp ≈ team win rate when this goalie plays (point% proxy) + tiny skill.
      const pp = 0.5 + 0.65 * ((ex.targetRow.teamPointPctg ?? 0.5) - 0.5);
      const roleTilt = 0.92 + 0.16 * (startShare - 0.5);
      return Math.max(
        0.05,
        Math.min(
          0.85,
          params.winsA * 0.35 +
            pp * roleTilt * 0.55 +
            params.winsB * (pp - 0.5) * 0.25 +
            params.winsC * gsax60,
        ),
      );
    }
    case "shutouts": {
      const gaPg = saPg * (1 - sv);
      return Math.max(0, Math.min(0.3, Math.exp(-gaPg) * params.shutoutCal));
    }
  }
}

/**
 * Pure derived fantasy rates from intermediates (SA, SV residual, team, role).
 * Complements learned models — meta can trust this when trees chase noise.
 */
export function goalieFactorSignal(
  params: GoalieStructuralParams,
  ex: { history: PlayerSeasonRow[]; targetRow: PlayerSeasonRow; seasonId: number },
  target: GoalieV2Target,
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
): number {
  const { eligible, leagueSv, sv, saPg } = goalieWorkloadContext(ex, league);
  const gsax60 = shrunkGsax60(eligible, registry);
  const prevSeason = ex.seasonId - 10001;
  const teamXsv =
    league.teamXsv.get(`${primaryTeam(ex.targetRow.team)}:${prevSeason}`) ?? leagueSv;
  const skillTilt = saPg > 0 ? Math.max(-0.012, Math.min(0.012, gsax60 / Math.max(saPg, 1))) : 0;
  const savePct = Math.max(
    0.885,
    Math.min(0.925, 0.6 * leagueSv + 0.25 * teamXsv + 0.15 * (sv + skillTilt)),
  );

  switch (target) {
    case "savePct":
      return savePct;
    case "saves":
      return Math.max(0, saPg * savePct);
    case "wins":
      return goalieStructuralSignal(params, ex, "wins", league, registry);
    case "shutouts": {
      const gaPg = saPg * (1 - savePct);
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
    // shifts once into the target season.
    const prior = league.svPct.get(seasonId - 10001) ?? 0.905;
    return shrunkSavePct(eligible, prior);
  }

  if (target === "saves") {
    // Volume Marcel: decay-weighted SA/g × history-era league SV% (not raw saves,
    // which bake in SV% luck).
    const leagueSv = league.svPct.get(seasonId - 10001) ?? 0.905;
    let saNum = 0;
    let saDen = 0;
    let w = 1;
    for (let i = eligible.length - 1; i >= 0; i--) {
      const r = eligible[i];
      const sv = r.savePct > 1 ? r.savePct / 100 : r.savePct;
      if (sv > 0 && sv < 1 && r.saves > 0 && r.gamesPlayed > 0) {
        saNum += w * (r.saves / sv);
        saDen += w * r.gamesPlayed;
      }
      w *= 0.7;
    }
    const saPg = saDen > 0 ? saNum / saDen : 30;
    return (saPg * leagueSv * saDen + 26 * 10) / (saDen + 10);
  }

  // Count rates: decay-weighted with GP-scaled prior.
  const PRIORS: Record<string, { rate: number; games: number }> = {
    wins: { rate: 0.45, games: 25 },
    shutouts: { rate: 0.035, games: 60 },
  };
  const prior = PRIORS[target];
  if (!prior) return NaN;
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
  mlp: Partial<Record<string, MlpModel>>;
  structural: GoalieStructuralParams;
  gbdtGp: GbdtModel;
  ridgeGp: RidgeV2;
  /** Optional; GP meta does not use MLP (unstable on small n). */
  mlpGp?: MlpModel;
  /** Indices into GOALIE_V2_FEATURES used for GBDT/ridge/MLP this boundary. */
  keptFeatureIdx: number[];
  keptFeatureNames: string[];
}

const GBDT_OPTS: GbdtOptions = {
  nEstimators: 250,
  learningRate: 0.05,
  maxDepth: 3,
  minChildWeight: 8,
  lambda: 1.5,
  subsample: 0.85,
  colsampleByTree: 0.7,
  earlyStoppingRounds: 20,
};

const MLP_OPTS: MlpOptions = {
  hidden: [24, 8],
  learningRate: 0.005,
  l2: 5e-3,
  batchSize: 32,
  maxEpochs: 120,
  earlyStoppingRounds: 15,
  seed: 42,
};

const RIDGE_LAMBDA_G = 80;

/** Weighted |corr| of a feature column vs target labels on train rows. */
function featureAbsCorr(
  col: Float64Array,
  rowIdx: number[],
  y: Float64Array,
  w: Float64Array,
): number {
  let sw = 0;
  let sx = 0;
  let sy = 0;
  let nFin = 0;
  for (let k = 0; k < rowIdx.length; k++) {
    const x = col[rowIdx[k]];
    if (!Number.isFinite(x) || !Number.isFinite(y[k])) continue;
    const wt = w[k] || 0;
    sw += wt;
    sx += wt * x;
    sy += wt * y[k];
    nFin++;
  }
  if (sw <= 0 || nFin < 25) return 0;
  const mx = sx / sw;
  const my = sy / sw;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let k = 0; k < rowIdx.length; k++) {
    const x = col[rowIdx[k]];
    if (!Number.isFinite(x) || !Number.isFinite(y[k])) continue;
    const wt = w[k] || 0;
    const dx = x - mx;
    const dy = y[k] - my;
    sxx += wt * dx * dx;
    syy += wt * dy * dy;
    sxy += wt * dx * dy;
  }
  const den = Math.sqrt(sxx * syy);
  return den > 0 ? Math.abs(sxy / den) : 0;
}

/**
 * Pick ~GOALIE_FEATURE_BUDGET columns: anchors first, then best univariate
 * correlation with factorized train labels (max over targets).
 */
function selectGoalieFeatureIndices(
  matrix: GoalieMatrix,
  examples: GoalieExample[],
  trainIdx: number[],
  league: GoalieLeagueContext,
  registry: MoneyPuckGoalieRegistry | null,
  levels: GoalieLevels,
): number[] {
  const scores = new Float64Array(matrix.featureNames.length);
  for (const target of GOALIE_V2_TARGETS) {
    const y = new Float64Array(trainIdx.length);
    const w = new Float64Array(trainIdx.length);
    for (let k = 0; k < trainIdx.length; k++) {
      const ex = examples[trainIdx[k]];
      y[k] = modelTrainY(target, ex.actualRow, league, registry, levels);
      w[k] = goalieSampleWeight(ex.actualRow, target);
    }
    for (let j = 0; j < matrix.columns.length; j++) {
      const c = featureAbsCorr(matrix.columns[j], trainIdx, y, w);
      if (c > scores[j]) scores[j] = c;
    }
  }

  const anchorIdx: number[] = [];
  const rest: { j: number; s: number }[] = [];
  for (let j = 0; j < matrix.featureNames.length; j++) {
    const name = matrix.featureNames[j];
    if (GOALIE_ANCHOR_FEATURES.has(name)) anchorIdx.push(j);
    else rest.push({ j, s: scores[j] });
  }
  rest.sort((a, b) => b.s - a.s);
  const kept = new Set(anchorIdx);
  for (const { j, s } of rest) {
    if (kept.size >= GOALIE_FEATURE_BUDGET) break;
    if (s <= 0.02) continue;
    kept.add(j);
  }
  // Fill if anchors alone are short.
  for (const { j } of rest) {
    if (kept.size >= GOALIE_FEATURE_BUDGET) break;
    kept.add(j);
  }
  return [...kept].sort((a, b) => a - b);
}

function subsetColumns(columns: Float64Array[], idx: number[]): Float64Array[] {
  return idx.map((j) => columns[j]);
}

function alignFeatureVector(
  fullVec: number[],
  fullNames: string[],
  modelNames: string[],
): number[] {
  if (modelNames.length === fullNames.length) return fullVec;
  const map = new Map(fullNames.map((n, i) => [n, fullVec[i]]));
  return modelNames.map((n) => {
    const v = map.get(n);
    return v != null && Number.isFinite(v) ? v : NaN;
  });
}

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

  const keptFeatureIdx = selectGoalieFeatureIndices(
    matrix,
    examples,
    trainIdx.length >= 40 ? trainIdx : [...trainIdx, ...valIdx],
    league,
    registry,
    levels,
  );
  const keptFeatureNames = keptFeatureIdx.map((j) => matrix.featureNames[j]);
  const keptCols = subsetColumns(matrix.columns, keptFeatureIdx);

  const nCols = keptCols.length;
  const sub = (idx: number[]): Float64Array[] => {
    const cols: Float64Array[] = new Array(nCols);
    for (let j = 0; j < nCols; j++) {
      const col = new Float64Array(idx.length);
      for (let k = 0; k < idx.length; k++) col[k] = keptCols[j][idx[k]];
      cols[j] = col;
    }
    return cols;
  };
  const trainCols = sub(trainIdx);
  const valCols = sub(valIdx);

  const gbdt: Record<string, GbdtModel> = {};
  const ridge: Record<string, RidgeV2> = {};
  const mlp: Record<string, MlpModel> = {};

  for (const target of GOALIE_V2_TARGETS) {
    const yT = new Float64Array(trainIdx.length);
    const wT = new Float64Array(trainIdx.length);
    for (let k = 0; k < trainIdx.length; k++) {
      const ex = examples[trainIdx[k]];
      yT[k] = modelTrainY(target, ex.actualRow, league, registry, levels);
      wT[k] = goalieSampleWeight(ex.actualRow, target);
    }
    const yV = new Float64Array(valIdx.length);
    const wV = new Float64Array(valIdx.length);
    for (let k = 0; k < valIdx.length; k++) {
      const ex = examples[valIdx[k]];
      yV[k] = modelTrainY(target, ex.actualRow, league, registry, levels);
      wV[k] = goalieSampleWeight(ex.actualRow, target);
    }
    gbdt[target] = fitGbdt(
      trainCols,
      yT,
      keptFeatureNames,
      target,
      wT,
      GBDT_OPTS,
      valCols,
      yV,
      wV,
    );

    const fitIdx = [...trainIdx, ...valIdx];
    const yF = new Float64Array(fitIdx.length);
    const wF = new Float64Array(fitIdx.length);
    for (let k = 0; k < fitIdx.length; k++) {
      const ex = examples[fitIdx[k]];
      yF[k] = modelTrainY(target, ex.actualRow, league, registry, levels);
      wF[k] = goalieSampleWeight(ex.actualRow, target);
    }
    ridge[target] = fitRidgeV2(keptCols, keptFeatureNames, fitIdx, yF, wF, RIDGE_LAMBDA_G);
    if (target !== "shutouts") {
      mlp[target] = fitMlp(
        keptCols,
        keptFeatureNames,
        trainIdx,
        yT,
        wT,
        target,
        MLP_OPTS,
        keptCols,
        yV,
        wV,
        valIdx,
      );
    }
  }

  const structural = fitGoalieStructural(
    examples.filter((ex) => ex.seasonId < boundarySeason),
    league,
    registry,
  );

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
  const gbdtGp = fitGbdt(
    trainCols,
    yGpT,
    keptFeatureNames,
    "gamesPlayed",
    wGpT,
    GBDT_OPTS,
    valCols,
    yGpV,
  );

  const fitIdx = [...trainIdx, ...valIdx];
  const yGpF = new Float64Array(fitIdx.length);
  const wGpF = new Float64Array(fitIdx.length);
  for (let k = 0; k < fitIdx.length; k++) {
    yGpF[k] = Math.min(72, gp82(examples[fitIdx[k]].actualRow));
    wGpF[k] = 1;
  }
  const ridgeGp = fitRidgeV2(keptCols, keptFeatureNames, fitIdx, yGpF, wGpF, RIDGE_LAMBDA_G);

  return {
    boundarySeason,
    gbdt,
    ridge,
    mlp,
    structural,
    gbdtGp,
    ridgeGp,
    keptFeatureIdx,
    keptFeatureNames,
  };
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
  const keptIdx = models.keptFeatureIdx ?? matrix.featureNames.map((_, i) => i);
  const keptNames = models.keptFeatureNames ?? matrix.featureNames;
  const nCols = keptIdx.length;
  const cols: Float64Array[] = new Array(nCols);
  for (let j = 0; j < nCols; j++) {
    const src = matrix.columns[keptIdx[j]];
    const col = new Float64Array(exampleRows.length);
    for (let k = 0; k < exampleRows.length; k++) col[k] = src[exampleRows[k]];
    cols[j] = col;
  }
  const n = exampleRows.length;

  const rates: Record<string, Record<GoalieSignal, Float64Array>> = {};
  for (const target of GOALIE_V2_TARGETS) {
    const hasMlp = !!models.mlp[target];
    const set: Record<GoalieSignal, Float64Array> = {
      gbdt: predictGbdtBatch(models.gbdt[target], cols),
      ridge: new Float64Array(n),
      mlp: hasMlp ? predictMlpBatch(models.mlp[target], cols) : new Float64Array(n),
      marcel: new Float64Array(n),
      ewma: new Float64Array(n),
      lag1: new Float64Array(n),
      structural: new Float64Array(n),
      factor: new Float64Array(n),
      market: new Float64Array(n),
    };
    const vec = new Array(nCols);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < nCols; j++) vec[j] = cols[j][k];
      const ex = examples[k];
      set.ridge[k] = modelDecodeY(
        target,
        predictRidgeV2(models.ridge[target], vec),
        ex.seasonId,
        league,
        levels,
      );
      set.gbdt[k] = modelDecodeY(target, set.gbdt[k], ex.seasonId, league, levels);
      const adj = (v: number): number =>
        goalieEraAdjust(target, v, levels, ex.history, ex.seasonId);
      const m = adj(goalieMarcelRate(ex.history, target, league, ex.seasonId));
      set.marcel[k] = Number.isFinite(m) ? m : fallbackRate(target);
      const e = adj(goalieEwma(ex.history, target));
      set.ewma[k] = Number.isFinite(e) ? e : set.marcel[k];
      const l = adj(goalieLag1(ex.history, target));
      set.lag1[k] = Number.isFinite(l) ? l : set.marcel[k];
      set.structural[k] = goalieStructuralSignal(
        models.structural,
        ex,
        target,
        league,
        registry,
      );
      set.factor[k] = goalieFactorSignal(models.structural, ex, target, league, registry);
      if (hasMlp) {
        set.mlp[k] = modelDecodeY(target, set.mlp[k], ex.seasonId, league, levels);
      } else {
        set.mlp[k] = set.factor[k];
      }
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
    const last = eligible.at(-1);
    let share = NaN;
    if (last) {
      const teamGp = league.teamGoalieGp.get(
        `${primaryTeam(last.team)}:${last.seasonId}`,
      );
      if (teamGp && teamGp > 0) share = Math.min(72, (last.gamesPlayed / teamGp) * 82);
    }
    gp.share[k] = Number.isFinite(share) ? share : gp.ewma[k];

    // Pull learned GP toward role share — public models live or die on starts.
    const sb = HEURISTICS.shareBlend;
    gp.gbdt[k] = Math.max(4, Math.min(72, (1 - sb) * gp.gbdt[k] + sb * gp.share[k]));
    gp.ridge[k] = Math.max(4, Math.min(72, (1 - sb) * gp.ridge[k] + sb * gp.share[k]));
    gp.ewma[k] = Math.max(4, Math.min(72, (1 - sb * 0.5) * gp.ewma[k] + sb * 0.5 * gp.share[k]));

    if (HEURISTICS.ageGp) {
      const age = ex.targetRow.age ?? NaN;
      const am = goalieAgeGpMult(age);
      gp.gbdt[k] *= am;
      gp.ridge[k] *= am;
      gp.ewma[k] *= am;
      gp.lag1[k] *= am;
      gp.share[k] *= am;
    }
  }

  normalizeTandemGp(examples, gp);
  applyTeamCascadeRates(examples, rates, league);
  void keptNames;
  return { rates, gp };
}

/** Age multiplier for expected GP (workload declines after ~32). */
export function goalieAgeGpMult(age: number): number {
  if (!Number.isFinite(age) || age <= 0) return 1;
  if (age <= 32) return 1;
  if (age <= 34) return 0.96;
  if (age <= 36) return 0.9;
  if (age <= 38) return 0.82;
  return 0.72;
}

/** Soft team GP budget: goalie GP signals on a team sum toward tandemGpTarget. */
function normalizeTandemGp(
  examples: GoalieExample[],
  gp: GoalieSignalSet["gp"],
): void {
  const target = HEURISTICS.tandemGpTarget;
  const keys = ["gbdt", "ridge", "ewma", "lag1", "share"] as const;
  for (const key of keys) {
    const groups = new Map<string, number[]>();
    for (let k = 0; k < examples.length; k++) {
      const team = primaryTeam(examples[k].targetRow.team);
      if (!team) continue;
      const list = groups.get(team) ?? [];
      list.push(k);
      groups.set(team, list);
    }
    for (const idxs of groups.values()) {
      if (idxs.length < 2) continue;
      let sum = 0;
      for (const i of idxs) sum += gp[key][i];
      if (!(sum > 35 && sum < 150)) continue;
      const scale = target / sum;
      for (const i of idxs) {
        gp[key][i] = Math.max(4, Math.min(72, gp[key][i] * scale));
      }
    }
  }
}

/**
 * Pull win rates toward team strength; pull save volume toward team SA mean.
 * Same-team goalies face similar environments when they play.
 */
function applyTeamCascadeRates(
  examples: GoalieExample[],
  rates: Record<string, Record<GoalieSignal, Float64Array>>,
  league: GoalieLeagueContext,
): void {
  const tw = HEURISTICS.teamWinsBlend;
  const groups = new Map<string, number[]>();
  for (let k = 0; k < examples.length; k++) {
    const team = primaryTeam(examples[k].targetRow.team);
    if (!team) continue;
    const list = groups.get(team) ?? [];
    list.push(k);
    groups.set(team, list);
  }

  for (const idxs of groups.values()) {
    // Team win environment (shared).
    for (const k of idxs) {
      const pp = 0.5 + 0.65 * ((examples[k].targetRow.teamPointPctg ?? 0.5) - 0.5);
      const blendWin = (arr: Float64Array): void => {
        arr[k] = clampTarget("wins", (1 - tw) * arr[k] + tw * pp);
      };
      blendWin(rates.wins.factor);
      blendWin(rates.wins.structural);
      blendWin(rates.wins.marcel);
    }

    const stb = HEURISTICS.savesTeamBlend;
    if (stb <= 0 || idxs.length < 2) continue;
    // Team mean SA volume (saves/gp proxy) — shrink individuals toward team mean.
    let saSum = 0;
    let n = 0;
    for (const k of idxs) {
      const v = rates.saves.factor[k];
      if (Number.isFinite(v) && v > 0) {
        saSum += v;
        n++;
      }
    }
    if (n < 2) continue;
    const teamSaves = saSum / n;
    for (const k of idxs) {
      rates.saves.factor[k] =
        (1 - stb) * rates.saves.factor[k] + stb * teamSaves;
      rates.saves.structural[k] =
        (1 - stb) * rates.saves.structural[k] + stb * teamSaves;
      rates.saves.marcel[k] =
        (1 - stb) * rates.saves.marcel[k] + stb * teamSaves;
    }
  }
  void league;
}

/**
 * Post-hoc team GP renormalization for finished projections (generate + backtest).
 * Scales gamesPlayed so teammates sum to ~tandemGpTarget while preserving ranks.
 */
export function renormalizeGoalieGamesByTeam<
  T extends { team: string; gamesPlayed: number; isGoalie: boolean },
>(players: T[], teamBudget = HEURISTICS.tandemGpTarget): T[] {
  const groups = new Map<string, number[]>();
  for (let i = 0; i < players.length; i++) {
    if (!players[i].isGoalie) continue;
    const team = primaryTeam(players[i].team);
    if (!team) continue;
    const list = groups.get(team) ?? [];
    list.push(i);
    groups.set(team, list);
  }
  const out = players.map((p) => ({ ...p }));
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    let sum = 0;
    for (const i of idxs) sum += out[i].gamesPlayed;
    if (!(sum > 35 && sum < 150)) continue;
    const scale = teamBudget / sum;
    for (const i of idxs) {
      out[i].gamesPlayed = Math.max(4, Math.min(72, Math.round(out[i].gamesPlayed * scale)));
    }
  }
  return out;
}

function clampTarget(target: GoalieV2Target, v: number): number {
  // Save% projections live in a tight band around league — matches reliability.
  if (target === "savePct") return Math.max(0.885, Math.min(0.925, v));
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
  const league = buildGoalieLeagueContext(rows, registry);
  const examples = buildGoalieExamples(rows);
  const levels = buildGoalieLevels(rows);
    onProgress?.(
      `goalie walk-forward: ${examples.length} examples, ${GOALIE_V2_FEATURES.length} candidates (prune→${GOALIE_FEATURE_BUDGET}), MP=${registry ? "yes" : "no"}`,
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
 * out-of-sample error. savePct/shutouts/saves are noise-dominated at the edges.
 */
const GOALIE_CALIBRATE_TARGETS: ReadonlySet<string> = new Set([
  "savePct",
  "shutouts",
]);

/** Starter vs backup role split for meta routing (exported for backtests). */
export function isStarterGoalie(ex: GoalieExample): boolean {
  const last = goalieEligible(ex.history).at(-1);
  if (!last) return false;
  if (last.gamesPlayed >= 40) return true;
  if ((last.gamesStarted ?? 0) >= 30) return true;
  return last.gamesPlayed >= 35;
}

export function isBackupGoalie(ex: GoalieExample): boolean {
  return !isStarterGoalie(ex);
}

const GOALIE_GP_SIGNALS = ["gbdt", "ridge", "ewma", "lag1", "structural"] as const;

/** Starter metas: learned stack + factor. */
const STARTER_TARGET_SIGNALS: Record<GoalieV2Target, readonly GoalieSignal[]> = {
  wins: ["factor", "gbdt", "ridge", "marcel", "structural", "market"],
  saves: ["factor", "gbdt", "ridge", "mlp", "structural", "marcel"],
  shutouts: ["factor", "structural", "marcel"],
  savePct: ["factor", "structural", "marcel", "gbdt"],
};

/** Backup metas: derived environment only — trees overfit tiny samples. */
const BACKUP_TARGET_SIGNALS: Record<GoalieV2Target, readonly GoalieSignal[]> = {
  wins: ["factor", "structural", "marcel"],
  saves: ["factor", "structural", "marcel"],
  shutouts: ["factor", "structural", "marcel"],
  savePct: ["factor", "structural", "marcel"],
};

function signalsForTarget(target: GoalieV2Target, backup: boolean): readonly GoalieSignal[] {
  if (backup) return BACKUP_TARGET_SIGNALS[target];
  if (target === "saves" && HEURISTICS.savesStructuralOnly) {
    return BACKUP_TARGET_SIGNALS.saves;
  }
  const starter = STARTER_TARGET_SIGNALS[target];
  if (HEURISTICS.dropMlpWins && target === "wins") {
    return starter.filter((s) => s !== "mlp");
  }
  return starter;
}

function goalieSignalRow(
  target: GoalieV2Target,
  sig: Record<GoalieSignal, Float64Array>,
  k: number,
  backup: boolean,
): number[] {
  return signalsForTarget(target, backup).map((s) => sig[s][k]);
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
        const low = isBackupGoalie(ex);
        acc[t].p.push(goalieMetaRate(metas, t, sig, k, low, false));
        acc[t].a.push(goalieActual(ex.actualRow, t));
        acc[t].w.push(goalieSampleWeight(ex.actualRow, t));
      }
    }
  }
  const out: Partial<Record<string, RateCalibrator>> = {};
  for (const t of GOALIE_V2_TARGETS) {
    if (!GOALIE_CALIBRATE_TARGETS.has(t)) continue; // others stay raw (no-op)
    out[t] = fitAffineCalibrator(acc[t].p, acc[t].a, acc[t].w, GOALIE_CALIB_K, 0.1);
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
        const backup = isBackupGoalie(ex);
        const row = goalieSignalRow(target, sig, k, backup);
        const y = goalieActual(ex.actualRow, target);
        let w = goalieSampleWeight(ex.actualRow, target) * recency;
        if (
          useMarket &&
          !backup &&
          sig.market &&
          signalsForTarget(target, false).includes("market")
        ) {
          const mkt = sig.market[k];
          const opp = sig.factor?.[k] ?? sig.structural?.[k] ?? 0.5 * (sig.gbdt[k] + sig.marcel[k]);
          w *= disagreementWeight(mkt, opp, statSd, disagreementSigma);
        }
        if (backup) {
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
    // Rare/noisy rates: convex keeps mass on reliable signals.
    const fit =
      target === "savePct" || target === "shutouts" ? fitMetaConvex : fitMetaNnls;
    rateMetas[target] = {
      established: fit(Xe, ye, we, signalsForTarget(target, false)),
      low: fit(Xl, yl, wl, signalsForTarget(target, true)),
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
      if (isBackupGoalie(ex)) {
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
  const raw = applyMeta(meta, goalieSignalRow(target, sig, k, low));
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
  mlp?: Record<string, MlpModel>;
  structural: GoalieStructuralParams;
  gbdtGp: GbdtModel;
  ridgeGp: RidgeV2;
  mlpGp?: MlpModel;
  keptFeatureNames?: string[];
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
  const exForRole = {
    playerId: targetRow.playerId,
    seasonId: targetRow.seasonId,
    targetRow,
    actualRow: targetRow,
    history,
  } as GoalieExample;
  const low = isBackupGoalie(exForRole);

  const fullVec = goalieFeatureVector(history, targetRow, league, registry);
  const ex = { history, targetRow, seasonId: targetRow.seasonId };

  const rates = {} as Record<GoalieV2Target, number>;
  for (const target of GOALIE_V2_TARGETS) {
    const modelNames =
      models.gbdt[target]?.featureNames ??
      models.keptFeatureNames ??
      GOALIE_V2_FEATURES;
    const vec = alignFeatureVector(fullVec, GOALIE_V2_FEATURES, modelNames);
    const adj = (v: number): number =>
      goalieEraAdjust(target, v, levels, history, targetRow.seasonId);
    const m = adj(goalieMarcelRate(history, target, league, targetRow.seasonId));
    const marcel = Number.isFinite(m) ? m : fallbackRate(target);
    const e = adj(goalieEwma(history, target));
    const l = adj(goalieLag1(history, target));
    const structural = goalieStructuralSignal(models.structural, ex, target, league, registry);
    const factor = goalieFactorSignal(models.structural, ex, target, league, registry);
    const bySignal: Record<GoalieSignal, number> = {
      gbdt: modelDecodeY(
        target,
        predictGbdt(models.gbdt[target], vec),
        targetRow.seasonId,
        league,
        levels,
      ),
      ridge: modelDecodeY(
        target,
        predictRidgeV2(models.ridge[target], vec),
        targetRow.seasonId,
        league,
        levels,
      ),
      mlp: models.mlp?.[target]
        ? modelDecodeY(
            target,
            predictMlp(
              models.mlp[target],
              alignFeatureVector(
                fullVec,
                GOALIE_V2_FEATURES,
                models.mlp[target].featureNames,
              ),
            ),
            targetRow.seasonId,
            league,
            levels,
          )
        : factor,
      marcel,
      ewma: Number.isFinite(e) ? e : marcel,
      lag1: Number.isFinite(l) ? l : marcel,
      structural,
      factor,
      market: 0,
    };
    bySignal.market =
      0.5 * bySignal.marcel + 0.3 * bySignal.ewma + 0.2 * bySignal.lag1;
    const meta = low ? metas.rateMetas[target].low : metas.rateMetas[target].established;
    const sigNames =
      meta.signals.length > 0 ? meta.signals : [...signalsForTarget(target, low)];
    const signalRow = sigNames.map((s) => bySignal[s as GoalieSignal] ?? 0);
    const raw = applyMeta(meta, signalRow);
    rates[target] = clampTarget(
      target,
      applyRateCalibrator(metas.calibrators?.[target], raw),
    );
  }

  {
    const leagueSv = trendLevel(league.svPct, targetRow.seasonId, 0.905);
    const volumeSv = Math.max(0.88, Math.min(0.92, leagueSv));
    const saPg = rates.saves / Math.max(volumeSv, 1e-6);
    rates.saves = Math.max(0, saPg * rates.savePct);
  }

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
  const gpNames = models.gbdtGp.featureNames ?? GOALIE_V2_FEATURES;
  const gpVec = alignFeatureVector(fullVec, GOALIE_V2_FEATURES, gpNames);
  const am = HEURISTICS.ageGp ? goalieAgeGpMult(targetRow.age ?? NaN) : 1;
  const sb = HEURISTICS.shareBlend;
  let gGbdt = Math.max(4, Math.min(72, predictGbdt(models.gbdtGp, gpVec)));
  let gRidge = Math.max(
    4,
    Math.min(
      72,
      predictRidgeV2(
        models.ridgeGp,
        alignFeatureVector(fullVec, GOALIE_V2_FEATURES, models.ridgeGp.featureNames),
      ),
    ),
  );
  gGbdt = (1 - sb) * gGbdt + sb * share;
  gRidge = (1 - sb) * gRidge + sb * share;
  const gpRow = [
    Math.max(4, Math.min(72, gGbdt * am)),
    Math.max(4, Math.min(72, gRidge * am)),
    Math.max(4, Math.min(72, ewma * am)),
    Math.max(4, Math.min(72, lag1 * am)),
    Math.max(4, Math.min(72, share * am)),
  ];
  const gpMeta = low ? metas.gpMeta.low : metas.gpMeta.established;
  const gamesPlayed = Math.max(4, Math.min(72, applyMeta(gpMeta, gpRow)));

  return { rates, gamesPlayed };
}
