/**
 * Shared dataset views for the v2 projection pipeline.
 *
 * One canonical feature schema used by training, walk-forward backtesting,
 * and inference. Missing values are NaN (GBDT routes them natively; linear
 * models mean-impute).
 */

import { scheduledGamesForSeason } from "../nhl-api";
import { sanitizeTargetSeasonRow } from "./features";
import { lookupTeamDepth } from "./team-depth";
import type { PlayerSeasonRow } from "./types";

export const V2_MIN_ELIGIBLE_GP = 10;

/** Stats whose lag trajectories feed the shared skater feature matrix. */
const CORE_TARGETS = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
] as const;

/** Aux trajectory stats: usage, shot quality, special teams, physicality. */
const AUX_PER_GAME = [
  "points",
  "plusMinus",
  "totalShotAttempts",
  "xGoals",
  "goalsAboveExpected",
  "highDangerShots",
  "gameScore",
  "evPoints",
  "ppGoals",
] as const;

const AUX_RATE = [
  "toiPerGame",
  "evToiPerGame",
  "ppToiPerGame",
  "shiftsPerGame",
  "shootingPct",
  "satPct",
  "oZoneStartPct",
  "ppToiPctPerGame",
  "ppGoalsPer60",
  "ppPointsPer60",
  "hitsPer60",
  "blockedShotsPer60",
  "penaltiesTakenPer60",
  "penaltiesDrawnPer60",
  "giveawaysPer60",
  "takeawaysPer60",
  "faceoffWinPct",
  "xGoalsPer60",
  "onIceXGoalsPct",
  "onIceCorsiPct",
] as const;

function lagNames(stat: string): string[] {
  return [`${stat}_lag1`, `${stat}_lag2`, `${stat}_lag3`, `${stat}_ewma`, `${stat}_trend`];
}

export const SKATER_V2_FEATURES: string[] = [
  // GP trajectory (82-game equivalents)
  ...lagNames("gp82"),
  "durability",
  "career_gp82",
  "prior_seasons",
  // Game-log durability (NaN where logs are unavailable). Computed over the
  // FULL history, not just eligible seasons — partial rookie seasons carry
  // real roster-timing information that the GP-filtered lags throw away.
  "avail_lag1",
  "avail_lag2",
  "avail_ewma",
  "inj82_lag1",
  "inj82_ewma",
  "spells_lag1",
  "spells_ewma",
  "longest_gap_lag1",
  "chronic_inj",
  "tail82_lag1",
  "head82_lag1",
  "share_lag1",
  "scratch82_lag1",
  // Ironman / late-season rest / physical wear (from game logs + usage)
  "streak_lag1",
  "full_season_lag1",
  "ironman_seasons",
  "late_miss_lag1",
  "late_avail_lag1",
  "rest_risk",
  "wear_lag1",
  "wear_ewma",
  "wear_trend",
  // Bio / identity
  "age",
  "age_sq",
  "height_in",
  "weight_lb",
  "shoots_left",
  "draft_round",
  "draft_overall",
  "years_since_draft",
  "pos_C",
  "pos_LW",
  "pos_RW",
  "pos_D",
  "is_young",
  // Team context (prior-season values only)
  "team_gf_pg",
  "team_ga_pg",
  "team_diff_pg",
  "team_rank",
  "team_point_pct",
  "team_elo",
  "team_hits_pg",
  "team_pim_pg",
  "team_blocks_pg",
  "team_pp_share",
  "team_pk_ga60",
  "team_changed",
  "years_on_team",
  // Era
  "league_gf_pg",
  "season_year",
  // Depth chart
  "depth_rank",
  "veterans_ahead",
  "opportunity",
  // Trajectories
  ...CORE_TARGETS.flatMap((s) => lagNames(`${s}_pg`)),
  ...AUX_PER_GAME.flatMap((s) => lagNames(`${s}_pg`)),
  ...AUX_RATE.flatMap((s) => lagNames(s)),
];

export interface SkaterExample {
  playerId: number;
  seasonId: number;
  /** Sanitized: team context replaced with prior-season values. */
  targetRow: PlayerSeasonRow;
  /** Raw actual outcome row (for metrics). */
  actualRow: PlayerSeasonRow;
  /** Prior seasons, ascending. */
  history: PlayerSeasonRow[];
}

export interface LeagueContext {
  /** seasonId → league-average team GF per game that season. */
  gfPerGame: Map<number, number>;
}

export function gp82(row: PlayerSeasonRow): number {
  return (row.gamesPlayed * 82) / scheduledGamesForSeason(row.seasonId);
}

export function buildLeagueContext(rows: PlayerSeasonRow[]): LeagueContext {
  const bySeason = new Map<number, Map<string, number>>();
  for (const row of rows) {
    if (!row.teamGoalsForPerGame) continue;
    const team = row.team.split(",")[0].trim().toUpperCase();
    let teams = bySeason.get(row.seasonId);
    if (!teams) {
      teams = new Map();
      bySeason.set(row.seasonId, teams);
    }
    if (!teams.has(team)) teams.set(team, row.teamGoalsForPerGame);
  }
  const gfPerGame = new Map<number, number>();
  for (const [seasonId, teams] of bySeason) {
    let sum = 0;
    for (const v of teams.values()) sum += v;
    gfPerGame.set(seasonId, teams.size > 0 ? sum / teams.size : 2.9);
  }
  return { gfPerGame };
}

export function indexPlayers(
  rows: PlayerSeasonRow[],
  isGoalie: boolean,
): Map<number, PlayerSeasonRow[]> {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    if (row.isGoalie !== isGoalie) continue;
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.seasonId - b.seasonId);
  }
  return byPlayer;
}

export function eligibleHistory(history: PlayerSeasonRow[]): PlayerSeasonRow[] {
  return history.filter((r) => r.gamesPlayed >= V2_MIN_ELIGIBLE_GP);
}

/**
 * Build one example per skater-season with >= minPriorSeasons eligible prior
 * seasons and a target season of at least minTargetGp games.
 */
export function buildSkaterExamples(
  rows: PlayerSeasonRow[],
  minPriorSeasons = 1,
  minTargetGp = V2_MIN_ELIGIBLE_GP,
): SkaterExample[] {
  const byPlayer = indexPlayers(rows, false);
  const examples: SkaterExample[] = [];
  for (const history of byPlayer.values()) {
    for (let i = 1; i < history.length; i++) {
      const raw = history[i];
      if (raw.gamesPlayed < minTargetGp) continue;
      const prior = history.slice(0, i);
      if (eligibleHistory(prior).length < minPriorSeasons) continue;
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

function stat(row: PlayerSeasonRow, key: string): number {
  const v = (row as unknown as Record<string, number | undefined>)[key];
  return v == null || !Number.isFinite(v) ? NaN : v;
}

function perGameStat(row: PlayerSeasonRow, key: string): number {
  const v = stat(row, key);
  if (!Number.isFinite(v)) return NaN;
  return row.gamesPlayed > 0 ? v / row.gamesPlayed : NaN;
}

function rateStat(row: PlayerSeasonRow, key: string): number {
  const v = stat(row, key);
  if (!Number.isFinite(v)) return NaN;
  if (key.endsWith("Pct") || key === "satPct" || key === "oZoneStartPct") {
    return v > 1 ? v / 100 : v;
  }
  if (key === "toiPerGame" || key === "evToiPerGame" || key === "ppToiPerGame") {
    return v / 60;
  }
  return v;
}

/** lag1..lag3 (most recent first), NaN-padded, from eligible prior seasons. */
function lags(
  eligible: PlayerSeasonRow[],
  extract: (row: PlayerSeasonRow) => number,
): [number, number, number] {
  const l1 = eligible.length >= 1 ? extract(eligible[eligible.length - 1]) : NaN;
  const l2 = eligible.length >= 2 ? extract(eligible[eligible.length - 2]) : NaN;
  const l3 = eligible.length >= 3 ? extract(eligible[eligible.length - 3]) : NaN;
  return [l1, l2, l3];
}

const EWMA_W = [0.5, 0.3, 0.2]; // lag1, lag2, lag3

function ewmaOf(l1: number, l2: number, l3: number): number {
  let sum = 0;
  let wSum = 0;
  const vals = [l1, l2, l3];
  for (let k = 0; k < 3; k++) {
    if (Number.isFinite(vals[k])) {
      sum += vals[k] * EWMA_W[k];
      wSum += EWMA_W[k];
    }
  }
  return wSum > 0 ? sum / wSum : NaN;
}

function trendOf(l1: number, l2: number): number {
  if (!Number.isFinite(l1) || !Number.isFinite(l2)) return NaN;
  return l1 - l2;
}

function pushLagBlock(
  out: number[],
  eligible: PlayerSeasonRow[],
  extract: (row: PlayerSeasonRow) => number,
): void {
  const [l1, l2, l3] = lags(eligible, extract);
  out.push(l1, l2, l3, ewmaOf(l1, l2, l3), trendOf(l1, l2));
}

function durabilityOf(eligible: PlayerSeasonRow[]): number {
  const gps = eligible.slice(-3).map((r) => gp82(r));
  if (gps.length === 0) return NaN;
  const mean = gps.reduce((a, b) => a + b, 0) / gps.length;
  if (mean <= 0) return 0.5;
  const variance = gps.reduce((s, g) => s + (g - mean) ** 2, 0) / gps.length;
  return Math.max(0.4, Math.min(1, 1 - (Math.sqrt(variance) / mean) * 0.5));
}

/** Scale a team-game count to an 82-game season (lockout/COVID safe). */
function per82(count: number, teamGames: number): number {
  return teamGames > 0 ? (count * 82) / teamGames : NaN;
}

/** Played / roster-window availability for one season (1 = never absent). */
function availOf(row: PlayerSeasonRow): number {
  const d = row.dur;
  if (!d || d.window <= 0) return NaN;
  return d.played / d.window;
}

/**
 * Game-log durability feature block (see SKATER_V2_FEATURES).
 * Uses full history: sub-10-GP seasons are exactly where roster-timing
 * signal lives for young players.
 */
export function pushDurabilityBlock(out: number[], history: PlayerSeasonRow[]): void {
  const recent = history.slice(-3);
  const a = recent.map((r) => availOf(r));
  const [a1, a2, a3] = [a.at(-1) ?? NaN, a.at(-2) ?? NaN, a.at(-3) ?? NaN];
  out.push(a1, a2, ewmaOf(a1, a2, a3));

  const inj = recent.map((r) =>
    r.dur ? per82(r.dur.inj + r.dur.tail, r.dur.teamGames) : NaN,
  );
  const [i1, i2, i3] = [inj.at(-1) ?? NaN, inj.at(-2) ?? NaN, inj.at(-3) ?? NaN];
  out.push(i1, ewmaOf(i1, i2, i3));

  const sp = recent.map((r) => (r.dur ? r.dur.spells : NaN));
  const [s1, s2, s3] = [sp.at(-1) ?? NaN, sp.at(-2) ?? NaN, sp.at(-3) ?? NaN];
  out.push(s1, ewmaOf(s1, s2, s3));

  const last = history.at(-1)?.dur;
  out.push(last ? last.longestGap : NaN);

  // Career chronic-injury index: recency-weighted injury misses per 82.
  let cSum = 0;
  let cW = 0;
  let w = 1;
  for (let i = history.length - 1; i >= 0 && history.length - i <= 6; i--) {
    const d = history[i].dur;
    if (d) {
      const v = per82(d.inj + d.tail, d.teamGames);
      if (Number.isFinite(v)) {
        cSum += w * v;
        cW += w;
      }
    }
    w *= 0.75;
  }
  out.push(cW > 0 ? cSum / cW : NaN);

  out.push(last ? per82(last.tail, last.teamGames) : NaN);
  out.push(last ? per82(last.head, last.teamGames) : NaN);
  out.push(last ? last.share : NaN);
  out.push(last ? per82(last.scratch, last.teamGames) : NaN);

  // Ironman streak + consecutive full seasons
  out.push(last ? last.streak / 82 : NaN);
  out.push(last ? last.fullSeason : NaN);
  let ironmanSeasons = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i].dur;
    if (d && d.fullSeason === 1) ironmanSeasons++;
    else break;
  }
  out.push(ironmanSeasons);

  // Late-season rest: misses in final 10 games × team contention
  out.push(last ? last.lateMiss : NaN);
  out.push(
    last && last.latePlayed + last.lateMiss > 0
      ? last.latePlayed / (last.latePlayed + last.lateMiss)
      : NaN,
  );
  const lastRow = history.at(-1);
  const contention = lastRow?.teamPointPctg ?? NaN;
  const lateMiss = last?.lateMiss ?? NaN;
  // High contention + late misses → playoff-rest risk (0–1-ish scale).
  out.push(
    Number.isFinite(lateMiss) && Number.isFinite(contention)
      ? (lateMiss / 10) * Math.max(0, (contention - 0.5) / 0.3)
      : NaN,
  );

  // Physical wear: (hits + blocks)/60 × TOI minutes — high-usage physical
  // players break down more often.
  const wearOf = (r: PlayerSeasonRow): number => {
    const toiMin = r.toiPerGame != null && r.toiPerGame > 0 ? r.toiPerGame / 60 : NaN;
    const hits = r.hitsPer60 ?? NaN;
    const blocks = r.blockedShotsPer60 ?? NaN;
    if (!Number.isFinite(toiMin)) return NaN;
    const physical =
      (Number.isFinite(hits) ? hits : 0) + (Number.isFinite(blocks) ? blocks : 0);
    return toiMin * physical;
  };
  const wears = recent.map(wearOf);
  const [w1, w2, w3] = [wears.at(-1) ?? NaN, wears.at(-2) ?? NaN, wears.at(-3) ?? NaN];
  out.push(w1, ewmaOf(w1, w2, w3), trendOf(w1, w2));
}

/**
 * Availability-structured GP signal: E[GP82] = 82 × roster share × in-window
 * availability, each EB-shrunk over the full history (decay 0.75 per season,
 * ~30 team-game prior). Ironman streaks nudge toward a full season; late-season
 * rest on contending teams nudges down. NaN when no game-log data exists.
 */
export function durabilityGpSignal(history: PlayerSeasonRow[]): number {
  let winSum = 0;
  let teamSum = 0;
  let playedSum = 0;
  let w = 1;
  for (let i = history.length - 1; i >= 0 && history.length - i <= 5; i--) {
    const d = history[i].dur;
    if (d && d.teamGames > 0) {
      winSum += w * d.window;
      teamSum += w * d.teamGames;
      playedSum += w * d.played;
    }
    w *= 0.75;
  }
  if (teamSum <= 0) return NaN;
  const share = (winSum + 0.94 * 30) / (teamSum + 30);
  const avail = (playedSum + 0.95 * 30) / (winSum + 30);
  let gp = 82 * share * avail;

  const last = history.at(-1);
  const d = last?.dur;
  if (d) {
    // Ironman: ending streak ≥40 or a full season → pull toward 80–82.
    // Guard on tail === 0: committed durability data predates the producer
    // fix and can carry a nonzero streak for players who finished injured.
    if (d.fullSeason === 1 || (d.streak >= 40 && d.tail === 0)) {
      const iron = Math.min(1, d.streak / 82);
      gp = gp * (1 - 0.25 * iron) + 81 * (0.25 * iron);
    }
    // Late rest on a contender: shave a few games off the projection.
    const contention = last?.teamPointPctg ?? 0;
    if (d.lateMiss >= 2 && contention >= 0.55 && d.tail === 0) {
      gp -= Math.min(4, d.lateMiss * 0.4 * ((contention - 0.5) / 0.25));
    }
  }
  return Math.max(10, Math.min(82, gp));
}

function primaryTeamOf(row: PlayerSeasonRow): string {
  return row.team.split(",")[0].trim().toUpperCase();
}

/**
 * Build the shared v2 skater feature vector. `target` must be sanitized
 * (prior-season team context) — never the realized target-season context.
 */
export function skaterFeatureVector(
  history: PlayerSeasonRow[],
  target: PlayerSeasonRow,
  league: LeagueContext,
): number[] {
  const eligible = eligibleHistory(history);
  const out: number[] = [];

  // GP trajectory
  pushLagBlock(out, eligible, (r) => gp82(r));
  out.push(durabilityOf(eligible));
  out.push(eligible.reduce((s, r) => s + gp82(r), 0) / 82);
  out.push(eligible.length);

  // Game-log durability
  pushDurabilityBlock(out, history);

  // Bio
  const age = target.age && target.age > 0 ? target.age : NaN;
  out.push(age);
  out.push(Number.isFinite(age) ? ((age - 27) * (age - 27)) / 100 : NaN);
  out.push(target.heightInches ?? NaN);
  out.push(target.weightPounds ?? NaN);
  out.push(target.shootsLeft ?? NaN);
  const draftRound = target.draftRound && target.draftRound > 0 ? target.draftRound : NaN;
  const draftOverall =
    target.draftOverallPick && target.draftOverallPick > 0 ? target.draftOverallPick : NaN;
  out.push(draftRound);
  out.push(draftOverall);
  const seasonYear = Math.floor(target.seasonId / 10000);
  out.push(
    target.draftYear && target.draftYear > 0 ? seasonYear - target.draftYear : NaN,
  );
  out.push(target.position === "C" ? 1 : 0);
  out.push(target.position === "LW" ? 1 : 0);
  out.push(target.position === "RW" ? 1 : 0);
  out.push(target.position === "D" ? 1 : 0);
  out.push(eligible.length <= 2 ? 1 : 0);

  // Team context (already prior-season via sanitize)
  out.push(target.teamGoalsForPerGame ?? NaN);
  out.push(target.teamGoalsAgainstPerGame ?? NaN);
  out.push(target.teamGoalDiffPerGame ?? NaN);
  out.push(target.teamLeagueRank != null ? target.teamLeagueRank / 32 : NaN);
  out.push(target.teamPointPctg ?? NaN);
  out.push(target.teamElo != null ? target.teamElo / 1000 : NaN);
  out.push(target.teamHitsPerGame ?? NaN);
  out.push(target.teamPimPerGame ?? NaN);
  out.push(target.teamBlocksPerGame ?? NaN);
  out.push(target.teamPpGoalShare ?? NaN);
  out.push(target.teamPkGaPer60 ?? NaN);
  const lastTeam = history.length > 0 ? primaryTeamOf(history[history.length - 1]) : "";
  const targetTeam = primaryTeamOf(target);
  out.push(lastTeam && targetTeam ? (lastTeam === targetTeam ? 0 : 1) : NaN);
  let yearsOnTeam = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (primaryTeamOf(history[i]) === targetTeam) yearsOnTeam++;
    else break;
  }
  out.push(yearsOnTeam);

  // Era
  out.push(league.gfPerGame.get(target.seasonId - 10001) ?? NaN);
  out.push((seasonYear - 2005) / 20);

  // Depth chart
  const depth = lookupTeamDepth(target.seasonId, target.playerId);
  out.push(depth ? depth.depthRank / Math.max(1, depth.positionDepth) : NaN);
  out.push(depth ? depth.veteransAhead / 5 : NaN);
  out.push(depth?.opportunityScore ?? NaN);

  // Trajectories
  for (const s of CORE_TARGETS) {
    pushLagBlock(out, eligible, (r) => perGameStat(r, s));
  }
  for (const s of AUX_PER_GAME) {
    pushLagBlock(out, eligible, (r) => perGameStat(r, s));
  }
  for (const s of AUX_RATE) {
    pushLagBlock(out, eligible, (r) => rateStat(r, s));
  }

  return out;
}

export interface FeatureMatrix {
  featureNames: string[];
  /** Column-major. */
  columns: Float64Array[];
  nRows: number;
}

export function buildFeatureMatrix(
  examples: SkaterExample[],
  league: LeagueContext,
): FeatureMatrix {
  const nRows = examples.length;
  const nCols = SKATER_V2_FEATURES.length;
  const columns: Float64Array[] = Array.from(
    { length: nCols },
    () => new Float64Array(nRows),
  );
  for (let i = 0; i < nRows; i++) {
    const vec = skaterFeatureVector(examples[i].history, examples[i].targetRow, league);
    for (let j = 0; j < nCols; j++) {
      columns[j][i] = vec[j];
    }
  }
  return { featureNames: [...SKATER_V2_FEATURES], columns, nRows };
}

/** Per-game rate of the actual outcome (training target). */
export function actualRate(row: PlayerSeasonRow, target: string): number {
  const v = (row as unknown as Record<string, number>)[target] ?? 0;
  return row.gamesPlayed > 0 ? v / row.gamesPlayed : 0;
}

/**
 * League-average per-game level of each target per season (10+ GP rows).
 * Used for era normalization: scoring environment drifts (league shots fell
 * ~12% from 2022-23 to 2025-26), and models anchored to prior-season levels
 * carry that bias into the target season.
 */
export function buildTargetLevels(
  rows: PlayerSeasonRow[],
  targets: readonly string[],
  isGoalie = false,
  minGp = 10,
): Record<string, Record<number, number>> {
  const totals = new Map<string, Map<number, { sum: number; gp: number }>>();
  for (const t of targets) totals.set(t, new Map());
  for (const row of rows) {
    if (row.isGoalie !== isGoalie || row.gamesPlayed < minGp) continue;
    for (const t of targets) {
      const m = totals.get(t)!;
      const agg = m.get(row.seasonId) ?? { sum: 0, gp: 0 };
      if (t === "savePct") {
        // Shot-weighted league save%: accumulate saves and shots.
        const sv = row.savePct > 1 ? row.savePct / 100 : row.savePct;
        if (sv > 0 && sv < 1 && row.saves > 0) {
          agg.sum += row.saves;
          agg.gp += row.saves / sv;
        }
      } else {
        agg.sum += (row as unknown as Record<string, number>)[t] ?? 0;
        agg.gp += row.gamesPlayed;
      }
      m.set(row.seasonId, agg);
    }
  }
  const levels: Record<string, Record<number, number>> = {};
  for (const [t, m] of totals) {
    const lm: Record<number, number> = {};
    for (const [s, agg] of m) {
      if (agg.gp > 0) lm[s] = agg.sum / agg.gp;
    }
    levels[t] = lm;
  }
  return levels;
}

/** Serializable per-season league levels for one target. */
export type LevelRecord = Record<number, number>;

function levelAt(levels: LevelRecord | undefined, seasonId: number): number | null {
  const v = levels?.[seasonId];
  return v != null && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Pre-season estimate of a season's league level: damped trend off the two
 * most recent usable prior seasons. COVID-shortened seasons are skipped as
 * the anchor (their compressed schedules distort league rates), which cut
 * held-out level MAE ~20% vs a plain lag chain. Pre-season info only.
 */
export function levelEstimate(
  levels: LevelRecord | undefined,
  seasonId: number,
): number {
  if (!levels) return NaN;
  const chain: number[] = [];
  for (let back = 1; back <= 6 && chain.length < 2; back++) {
    const sid = seasonId - back * 10001;
    const l = levelAt(levels, sid);
    if (l == null) continue;
    if (chain.length === 0 && scheduledGamesForSeason(sid) < 70) continue;
    chain.push(l);
  }
  if (chain.length === 2) return chain[0] + 0.5 * (chain[0] - chain[1]);
  if (chain.length === 1) return chain[0];
  return NaN;
}

/**
 * Era anchor of a player's recent history: recency-weighted league level over
 * the last 3 eligible seasons (matches EWMA weights of persistence signals).
 */
export function historyLevelAnchor(
  levels: LevelRecord | undefined,
  eligible: PlayerSeasonRow[],
): number {
  const recent = eligible.slice(-3);
  const w = [0.5, 0.3, 0.2];
  let sum = 0;
  let ws = 0;
  for (let k = 0; k < recent.length; k++) {
    const lvl = levelAt(levels, recent[recent.length - 1 - k].seasonId);
    if (lvl != null) {
      sum += w[k] * lvl;
      ws += w[k];
    }
  }
  return ws > 0 ? sum / ws : NaN;
}

/** Multiplicative era factor from a player's history era to the target season. */
export function eraFactor(
  levels: LevelRecord | undefined,
  eligible: PlayerSeasonRow[],
  targetSeasonId: number,
): number {
  const anchor = historyLevelAnchor(levels, eligible);
  const lvlT = levelEstimate(levels, targetSeasonId);
  if (!Number.isFinite(anchor) || !Number.isFinite(lvlT) || anchor <= 0) return 1;
  // Clamp — era drift is a few % per season; larger ratios are data artifacts.
  return Math.max(0.85, Math.min(1.18, lvlT / anchor));
}
