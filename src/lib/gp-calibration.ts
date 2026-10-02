import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { loadLeagueSeasonsSync, MIN_SEASON_COVERAGE, seasonCoverage } from "./league-seasons";
import { durabilityKey, loadDurabilityRegistrySync } from "./ml/gamelog-durability";
import { loadMoneyPuckSkaterRegistrySync, skaterSeasonKey } from "./moneypuck-skaters";
import type { PlayerProfile } from "./profile-types";
import {
  loadSplitSeasonGpParams,
  predictSplitSeasonGp,
  splitSeasonInput,
  type SplitSeasonGpParams,
  type SplitSeasonSources,
} from "./split-season-gp";
import type {
  GoalieProjection,
  PlayerAvailability,
  PlayerProjection,
  SkaterProjection,
} from "./types";
import { SKATER_CATEGORIES } from "./types";
import { normalizeTeamAbbrev } from "./team-abbreviations";

/**
 * Post-hoc games-played calibration of the v2 skaters.
 *
 * The v2 GP model is trained on target seasons of 10+ games only: it
 * predicts the games of a player who plays, not the expectation a fantasy
 * board needs (≈15 % of the skaters with 10+ games one season play fewer
 * than 10 the next, and the model gave them ~45). The calibration maps the
 * model's GP onto what the NEXT season gave, out of sample: walk-forward
 * pairs (model GP at season T, trained on seasons < T → actual GP at T on
 * an 82-game basis, 0 for a player who did not play but was still around:
 * an NHL game later, or still on a club's list), 2018-19 → 2025-26, one
 * isotonic curve (PAVA, monotone: the model's order is kept) per meta
 * segment young / veteran × F / D. Players who retired or left the NHL are
 * left out: they are not on a board (src/data/inactive-player-ids.json and
 * the stale-player rule of generate).
 * Fitted by `npm run gp:fit` (scripts/fit-gp-calibration.ts) into
 * src/data/ml/gp-calibration.json, with its walk-forward backtest.
 *
 * History: the previous curve was fitted at generate time on the board's
 * own players, model GP → their realized GP of the two PRIOR seasons with
 * the zeros left out, i.e. on the wrong target (survivors' past), and on the
 * 2026-07-30 board whose model GP came from a dataset that no longer
 * matched the bundle (mean 50.6, max 69, against 56.8 / 82 with the
 * matching file): the « regression toward the mean » it corrected was that
 * drift (src/lib/ml/dataset-manifest.ts now refuses such a dataset).
 *
 * Counting stats are scaled with GP so per-game rates are untouched.
 */

/** Season-total ceiling for a calibrated expectation (E[GP] of an ironman). */
export const CALIBRATED_GP_CEILING = 80;

export interface IsotonicPoint {
  x: number;
  y: number;
}

/** Meta segment of a v2 skater: young (≤ 2 eligible NHL seasons) or veteran × F / D. */
export type GpGroup = "youngF" | "youngD" | "vetF" | "vetD";
export const GP_GROUPS: readonly GpGroup[] = ["youngF", "youngD", "vetF", "vetD"];

/** src/data/ml/gp-calibration.json */
export interface GpOosCalibration {
  version: 2;
  fittedAt: string;
  /** trainedAt of the bundle whose walk-forward produced the pairs (same code and dataset). */
  bundleTrainedAt: string | null;
  /** Dataset sha1 the walk-forward ran on. */
  datasetSha1: string | null;
  source: string;
  curves: Record<GpGroup, IsotonicPoint[]>;
  pairCount: Record<GpGroup, number>;
  /** Walk-forward backtest (fit on seasons < T, scored on T). */
  backtest?: Record<string, unknown>;
}

export interface GpCalibrationMeta {
  version: 2;
  appliedAt: string;
  fittedAt: string;
  source: string;
  skaterCurves: Record<GpGroup, IsotonicPoint[]>;
  pairCount: Record<GpGroup, number>;
}

export const GP_CALIBRATION_PATH = join(process.cwd(), "src", "data", "ml", "gp-calibration.json");

export function loadGpCalibration(path = GP_CALIBRATION_PATH): GpOosCalibration | null {
  if (!existsSync(path)) return null;
  const cal = JSON.parse(readFileSync(path, "utf8")) as GpOosCalibration;
  return cal.version === 2 ? cal : null;
}

export function gpGroupOf(young: boolean, isDefense: boolean): GpGroup {
  return `${young ? "young" : "vet"}${isDefense ? "D" : "F"}` as GpGroup;
}

/** Group of a board skater: its v2 segment and its build position. */
export function gpGroupOfPlayer(p: {
  modelSegment?: "young" | "vet";
  primaryPosition?: string;
  position?: string;
}): GpGroup {
  return gpGroupOf(p.modelSegment === "young", (p.primaryPosition ?? p.position) === "D");
}

/** The calibration curve of a board skater (empty: model GP kept). */
export function gpCurveFor(
  cal: Pick<GpOosCalibration, "curves"> | null,
  p: { modelSegment?: "young" | "vet"; primaryPosition?: string; position?: string },
): IsotonicPoint[] {
  return cal?.curves[gpGroupOfPlayer(p)] ?? [];
}

interface WeightedPair {
  x: number;
  y: number;
  w: number;
}

/** Pool-adjacent-violators: weighted isotonic (non-decreasing) fit. */
export function fitIsotonic(pairs: WeightedPair[]): IsotonicPoint[] {
  // Pre-aggregate ties on x (weighted mean) so the fit is deterministic
  // regardless of input order.
  const byX = new Map<number, { sumWY: number; sumW: number }>();
  for (const p of pairs) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !(p.w > 0)) continue;
    const agg = byX.get(p.x) ?? { sumWY: 0, sumW: 0 };
    agg.sumWY += p.w * p.y;
    agg.sumW += p.w;
    byX.set(p.x, agg);
  }
  const sorted = [...byX.entries()]
    .map(([x, agg]) => ({ x, y: agg.sumWY / agg.sumW, w: agg.sumW }))
    .sort((a, b) => a.x - b.x);
  if (sorted.length === 0) return [];
  type Block = { sumWY: number; sumW: number; minX: number; maxX: number };
  const stack: Block[] = [];
  for (const p of sorted) {
    let cur: Block = { sumWY: p.w * p.y, sumW: p.w, minX: p.x, maxX: p.x };
    while (
      stack.length > 0 &&
      stack[stack.length - 1].sumWY / stack[stack.length - 1].sumW >=
        cur.sumWY / cur.sumW
    ) {
      const prev = stack.pop()!;
      cur = {
        sumWY: prev.sumWY + cur.sumWY,
        sumW: prev.sumW + cur.sumW,
        minX: prev.minX,
        maxX: cur.maxX,
      };
    }
    stack.push(cur);
  }
  return stack.map((b) => ({ x: (b.minX + b.maxX) / 2, y: b.sumWY / b.sumW }));
}

/**
 * Evaluate the isotonic curve: linear interpolation between block centers,
 * slope-bounded extrapolation past the last block, ceiling-clamped.
 */
export function predictIsotonic(curve: IsotonicPoint[], x: number): number {
  if (curve.length === 0) return x;
  if (x <= curve[0].x) return curve[0].y;
  const last = curve[curve.length - 1];
  if (x >= last.x) {
    const prev = curve[curve.length - 2];
    const slope =
      prev && prev.x < last.x ? Math.max(0, (last.y - prev.y) / (last.x - prev.x)) : 0;
    return Math.min(CALIBRATED_GP_CEILING, last.y + slope * (x - last.x));
  }
  for (let i = 1; i < curve.length; i++) {
    if (x <= curve[i].x) {
      const t = (x - curve[i - 1].x) / (curve[i].x - curve[i - 1].x || 1);
      return curve[i - 1].y + t * (curve[i].y - curve[i - 1].y);
    }
  }
  return last.y;
}

/** The two prior seasonIds for a "YYYY-YY" projection season (e.g. 2026-27). */
export function priorSeasonIdsFor(season: string): [number, number] {
  const startYear = Number.parseInt(season.slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return [20252026, 20242025];
  const id = (y: number) => y * 10000 + (y + 1);
  return [id(startYear - 1), id(startYear - 2)];
}

/** 20262027 for "2026-27". */
export function projectionSeasonIdOf(season: string): number {
  const startYear = Number.parseInt(season.slice(0, 4), 10);
  return startYear * 10000 + startYear + 1;
}

function realizedGp(
  profile: PlayerProfile | undefined,
  seasonId: number,
  isGoalie: boolean,
): number {
  if (!profile) return 0;
  return profile.teamHistory
    .filter((h) => h.isGoalie === isGoalie && h.seasonId === seasonId)
    .reduce((sum, h) => sum + h.gamesPlayed, 0);
}

type CalibratablePlayer = Pick<
  PlayerProjection,
  "id" | "team" | "isGoalie" | "gamesPlayed"
> & { modelGamesPlayed?: number };

/** Model GP before any calibration (idempotence anchor). */
export function modelGp(player: CalibratablePlayer): number {
  return player.modelGamesPlayed ?? player.gamesPlayed;
}

/** One out-of-sample pair: model GP at season T → actual GP (82-game basis, 0 included). */
export interface GpOosPair {
  group: GpGroup;
  x: number;
  y: number;
}

/**
 * One isotonic curve per group, model GP (rounded, as published) → mean
 * actual GP of the next season.
 */
export function fitGroupCurves(pairs: GpOosPair[]): {
  curves: Record<GpGroup, IsotonicPoint[]>;
  pairCount: Record<GpGroup, number>;
} {
  const curves = {} as Record<GpGroup, IsotonicPoint[]>;
  const pairCount = {} as Record<GpGroup, number>;
  for (const g of GP_GROUPS) {
    const sub = pairs.filter((p) => p.group === g);
    curves[g] = fitIsotonic(sub.map((p) => ({ x: Math.round(p.x), y: Math.min(82, Math.max(0, p.y)), w: 1 })));
    pairCount[g] = sub.length;
  }
  return { curves, pairCount };
}

/**
 * Calibrated GP for one skater, `curve` being his group's (gpCurveFor).
 * Players with no NHL skater history keep the model GP: the curves are fit
 * on v2 skaters; the contextual path has its own prior
 * (src/lib/projection-gp.ts contextualSkaterGp).
 */
export function calibratedSkaterGp(
  player: CalibratablePlayer,
  profile: PlayerProfile | undefined,
  curve: IsotonicPoint[],
): number {
  const hasHistory =
    profile?.teamHistory.some((h) => !h.isGoalie && h.gamesPlayed > 0) ?? false;
  const base = modelGp(player);
  if (!hasHistory || curve.length === 0) return base;
  const mapped = predictIsotonic(curve, base);
  return Math.max(1, Math.min(CALIBRATED_GP_CEILING, Math.round(mapped)));
}

/** The split-season rule and where its inputs come from (see split-season-gp.ts). */
export interface SplitSeasonRule {
  params: SplitSeasonGpParams;
  sources: SplitSeasonSources;
  projectionSeasonId: number;
}

export interface SkaterGpDecision {
  /** Published GP. */
  gamesPlayed: number;
  /** What the isotonic curve says (the published GP when no rule applies). */
  curveGamesPlayed: number;
  /** Set when the split-season rule replaced the curve. */
  availability: PlayerAvailability | null;
}

/**
 * Published GP for one skater. The isotonic curve, except when his last
 * season was a split or an away season (src/lib/split-season-gp.ts): the
 * curve maps model GP onto realized prior-season GP, which for a call-up or
 * a late signing measures the games he spent in another league, so the
 * calibrated split-season rule answers instead. Every other skater, full
 * season or injured, gets exactly the curve.
 */
export function decideSkaterGp(
  player: CalibratablePlayer,
  profile: PlayerProfile | undefined,
  curve: IsotonicPoint[],
  rule?: SplitSeasonRule | null,
): SkaterGpDecision {
  const curveGp = calibratedSkaterGp(player, profile, curve);
  const hasHistory =
    profile?.teamHistory.some((h) => !h.isGoalie && h.gamesPlayed > 0) ?? false;
  const input =
    rule && hasHistory && !player.isGoalie
      ? splitSeasonInput(player.id, rule.projectionSeasonId, rule.sources)
      : null;
  if (!rule || !input) {
    return { gamesPlayed: curveGp, curveGamesPlayed: curveGp, availability: null };
  }
  const gp = Math.max(
    1,
    Math.min(CALIBRATED_GP_CEILING, Math.round(predictSplitSeasonGp(rule.params, input))),
  );
  const gpSd = rule.params[input.kind].roleSd;
  return {
    gamesPlayed: gp,
    curveGamesPlayed: curveGp,
    availability: {
      kind: input.kind,
      seasonId: input.seasonId,
      otherGames: input.otherGames,
      league: input.league,
      curveGamesPlayed: curveGp,
      ...(gpSd != null ? { gpSd } : {}),
    },
  };
}

/**
 * Rule inputs from the committed game logs and league-seasons cache. Null
 * (every skater gets the curve, with a warning) when a file is missing, or
 * when the cache predates the last completed season: the rule would then
 * see no split season at all and silently stop applying (a new season's
 * `npm run collect:leagues` refetches the players it lacks).
 */
export function splitSeasonRuleFromFiles(
  projectionSeasonId: number,
): SplitSeasonRule | null {
  const params = loadSplitSeasonGpParams();
  const leagues = loadLeagueSeasonsSync();
  const durability = loadDurabilityRegistrySync();
  const moneypuck = loadMoneyPuckSkaterRegistrySync();
  if (!params || !leagues) return null;
  const last = projectionSeasonId - 10001;
  const coverage = seasonCoverage(leagues, last);
  if (coverage < MIN_SEASON_COVERAGE) {
    console.warn(
      `WARN: src/data/league-seasons.json covers ${last} for ${(coverage * 100).toFixed(0)}% of the players active the season before (< ${MIN_SEASON_COVERAGE * 100}%): run npm run collect:leagues`,
    );
    return null;
  }
  return {
    params,
    projectionSeasonId,
    sources: {
      durability: (id, seasonId) => durability?.byKey[durabilityKey(id, seasonId)],
      leagues: (id) => leagues.players[String(id)],
      moneypuck: (id, seasonId) => moneypuck?.byKey[skaterSeasonKey(id, seasonId)],
    },
  };
}

/** Tandem season budget shared by a team's goalies (starts, ≈82 games). */
export const GOALIE_TEAM_BUDGET = 80;
/** Hard ceiling on a single goalie's starts expectation. */
export const GOALIE_STARTER_CEILING = 65;

/**
 * Starter share of the team budget, driven by the starter's own recent
 * workload (0.7 × last season + 0.3 × season before). A 45-start 1A maps to
 * 0.55; a 60+ start workhorse approaches 0.80. This replaces the flat 62%
 * share that pinned every clear starter to exactly 50 starts and erased the
 * workhorse-vs-tandem signal entirely.
 */
export function goalieStarterShare(historicalStarts: number): number {
  const hist = historicalStarts > 0 ? historicalStarts : 45;
  return Math.min(0.8, Math.max(0.55, 0.55 + (0.45 * (hist - 45)) / 35));
}

/**
 * Recompute each team's goalie GP split from the committed workload ordering
 * and the starter's historical starts. Returns id → calibrated GP.
 *
 * The goalie games of the 2026-09-27 board (`gp:recalibrate`); no longer
 * published since 2026-10-02 (gp:recalibrate and generate both allocate
 * with renormalizeGoalieGamesByTeam of src/lib/ml/goalie-v2.ts). Kept as
 * the « previous engine » of scripts/backtest-goalie-gp.ts: walk-forward
 * MAE 10.58 against 9.72, backups −5.3 games of bias, established starters
 * +7.3.
 */
export function calibratedGoalieGp(
  players: CalibratablePlayer[],
  profilesById: Map<number, PlayerProfile>,
  season: string,
): Map<number, number> {
  const [recentId, olderId] = priorSeasonIdsFor(season);
  const byTeam = new Map<string, CalibratablePlayer[]>();
  for (const p of players) {
    if (!p.isGoalie) continue;
    const team = normalizeTeamAbbrev(p.team);
    if (!team) continue;
    const list = byTeam.get(team) ?? [];
    list.push(p);
    byTeam.set(team, list);
  }

  const out = new Map<number, number>();
  for (const goalies of byTeam.values()) {
    const ordered = [...goalies].sort((a, b) => modelGp(b) - modelGp(a));
    const starter = ordered[0];
    if (!starter) continue;
    if (ordered.length === 1) {
      out.set(starter.id, Math.min(GOALIE_STARTER_CEILING, Math.max(modelGp(starter), 4)));
      continue;
    }
    const profile = profilesById.get(starter.id);
    const hist =
      0.7 * realizedGp(profile, recentId, true) +
      0.3 * realizedGp(profile, olderId, true);
    const starterGp = Math.min(
      GOALIE_STARTER_CEILING,
      Math.round(GOALIE_TEAM_BUDGET * goalieStarterShare(hist)),
    );
    out.set(starter.id, starterGp);

    const rest = ordered.slice(1);
    const restModelTotal = rest.reduce((s, g) => s + modelGp(g), 0);
    const remaining = Math.max(0, GOALIE_TEAM_BUDGET - starterGp);
    for (const g of rest) {
      const share = restModelTotal > 0 ? modelGp(g) / restModelTotal : 1 / rest.length;
      const gp = Math.max(4, Math.min(starterGp, Math.round(remaining * share)));
      out.set(g.id, gp);
    }
  }
  return out;
}

/** Scale a skater projection with a GP change, preserving per-game rates. */
export function scaleSkaterProjection(
  projection: SkaterProjection,
  ratio: number,
): SkaterProjection {
  const out = { ...projection };
  for (const cat of SKATER_CATEGORIES) {
    out[cat] = Math.max(0, Math.round((projection[cat] ?? 0) * ratio));
  }
  return out;
}

/** Scale a goalie projection with a GP change (savePct is a rate — kept). */
export function scaleGoalieProjection(
  projection: GoalieProjection,
  ratio: number,
): GoalieProjection {
  return {
    wins: Math.max(0, Math.round(projection.wins * ratio)),
    shutouts: Math.max(0, Math.round(projection.shutouts * ratio)),
    saves: Math.max(0, Math.round(projection.saves * ratio)),
    savePct: projection.savePct,
  };
}
