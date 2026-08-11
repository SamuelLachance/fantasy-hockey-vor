import type { PlayerProfile } from "./profile-types";
import type {
  GoalieProjection,
  PlayerProjection,
  SkaterProjection,
} from "./types";
import { SKATER_CATEGORIES } from "./types";
import { normalizeTeamAbbrev } from "./team-abbreviations";

/**
 * Post-hoc games-played calibration.
 *
 * The GP model heads regress hard toward the population mean: on the committed
 * 2026-27 board the top-150 skaters project 60.9 GP on average while the same
 * players realized 73.7 GP in 2025-26 and 73.5 in 2024-25, and no player at
 * all projects above 69. Rather than retraining (the ML dataset is gitignored
 * and heavy to rebuild), we correct the bias where it is measurable: an
 * isotonic regression (PAVA) maps projected GP onto the realized GP of the
 * same players in the two prior seasons. Monotone by construction, so the
 * model's durability ordering is preserved — only the level is fixed.
 *
 * Counting stats are scaled with GP so per-game rates are untouched.
 */

/** Season-total ceiling for a calibrated expectation (E[GP] of an ironman). */
export const CALIBRATED_GP_CEILING = 80;
const FULL_SEASON = 82;

/** Weight of the most recent prior season vs the one before in the fit. */
const RECENT_SEASON_WEIGHT = 0.65;

export interface IsotonicPoint {
  x: number;
  y: number;
}

export interface GpCalibrationMeta {
  version: 1;
  appliedAt: string;
  skaterCurve: IsotonicPoint[];
  pairCount: number;
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

/**
 * Fit the skater calibration curve on (projected GP → realized prior-season
 * GP) pairs across every skater with NHL history on the board.
 */
export function fitSkaterGpCurve(
  players: CalibratablePlayer[],
  profilesById: Map<number, PlayerProfile>,
  season: string,
): { curve: IsotonicPoint[]; pairCount: number } {
  const [recentId, olderId] = priorSeasonIdsFor(season);
  const pairs: WeightedPair[] = [];
  for (const p of players) {
    if (p.isGoalie) continue;
    const profile = profilesById.get(p.id);
    const recent = realizedGp(profile, recentId, false);
    const older = realizedGp(profile, olderId, false);
    const x = modelGp(p);
    if (recent > 0) {
      pairs.push({ x, y: Math.min(FULL_SEASON, recent), w: RECENT_SEASON_WEIGHT });
    }
    if (older > 0) {
      pairs.push({ x, y: Math.min(FULL_SEASON, older), w: 1 - RECENT_SEASON_WEIGHT });
    }
  }
  return { curve: fitIsotonic(pairs), pairCount: pairs.length };
}

/**
 * Calibrated GP for one skater. Players with no NHL skater history keep the
 * model GP: the curve is fit on players with history, and the rookie path
 * (contextual dossiers) was never shown to carry the same bias.
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
