import { leagueAverageSavePct, savesAboveAverage } from "./goalie-impact";
import { DEFAULT_LEAGUE, replacementRank } from "./league";
import { loadMlModels } from "./ml/train";
import type {
  Category,
  GoalieCategory,
  GoalieProjection,
  LeagueSettings,
  Position,
  SkaterCategory,
  SkaterProjection,
} from "./types";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "./types";

export interface CategoryDifficultyMeta {
  /** Normalized weight used in fantasy value (mean ≈ 1, clamped). */
  weight: number;
  /** Elite vs replacement gap divided by league std (informational). */
  scarcity: number;
  /** Coefficient of variation (std / mean); 1 for zero-centered stats. */
  cv: number;
  /**
   * Gini of production among players who generate the stat — the driver of the
   * skater weight. High = a few players produce most of it (goals, PP points):
   * hard to produce, so scarce and valuable. Low = evenly spread (hits, PIM):
   * easy to produce. 0 for zero-centered stats (goalie savePct).
   */
  gini: number;
  /** Holdout R² from ML models when available. */
  r2: number | null;
  /** For savePct these are in saves-above-average units, not raw SV%. */
  replacementLevel: number;
  eliteLevel: number;
}

/**
 * In H2H categories every category is worth exactly one matchup point, so
 * equal weights are the neutral baseline. The difficulty heuristic is applied
 * as a partial tilt on top of that baseline: weights are shrunk halfway
 * toward 1, then clamped, so no category is ever effectively deleted or
 * double-counted by population artifacts.
 *
 * Skater difficulty = how hard the stat is to produce, measured by the Gini
 * concentration of production: few players producing a lot (goals) is scarce
 * and weighted up; production everyone racks up (hits, PIM) is weighted down.
 * Goalie categories keep the elite-vs-replacement scarcity measure because
 * savePct is scored as signed saves-above-average, where a Gini is undefined.
 */
const SCARCITY_TILT = 0.5;
const WEIGHT_MIN = 0.7;
const WEIGHT_MAX = 1.4;

/**
 * Gini coefficient of the positive production values. 0 = perfectly even
 * (everyone produces the same), → 1 = one player produces everything. This is
 * exactly "how few players produce a lot": the harder-to-generate the stat,
 * the higher the concentration.
 */
function gini(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n < 2) return 0;
  let cumulative = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    cumulative += xs[i];
    weighted += cumulative;
  }
  if (cumulative <= 0) return 0;
  return (n + 1 - 2 * (weighted / cumulative)) / n;
}

export interface CategoryDifficultyWeights {
  skater: Record<SkaterCategory, CategoryDifficultyMeta>;
  goalie: Record<GoalieCategory, CategoryDifficultyMeta>;
}

type PlayerLike = {
  isGoalie: boolean;
  positions: Position[];
  gamesPlayed: number;
  projection: SkaterProjection | GoalieProjection;
};

function getStat(
  projection: SkaterProjection | GoalieProjection,
  category: Category,
): number {
  return (projection as unknown as Record<string, number>)[category] ?? 0;
}

/**
 * Category value used for spreads and scarcity. savePct is converted to
 * saves above average so a rate stat bounded near 0.9 (where std/mean and
 * elite-vs-replacement gaps are meaninglessly tiny) competes on the same
 * footing as counting stats, weighted by shot volume.
 */
function statValue(
  projection: SkaterProjection | GoalieProjection,
  category: Category,
  leagueSavePct: number,
): number {
  if (category === "savePct") {
    return savesAboveAverage(projection as GoalieProjection, leagueSavePct);
  }
  return getStat(projection, category);
}

function mean(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return 0;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function stdDev(values: number[]): number {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length < 2) return 1;
  const avg = mean(valid);
  const variance =
    valid.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (valid.length - 1);
  return Math.sqrt(variance) || 1;
}

function mlR2ByCategory(): Partial<Record<Category, number>> {
  const bundle = loadMlModels();
  if (!bundle) return {};
  const out: Partial<Record<Category, number>> = {};
  // Degenerate fits can report absurd R² (huge negatives); treat anything
  // outside a plausible range as "no signal" instead of exporting garbage.
  const sane = (r2: number): number | undefined =>
    Number.isFinite(r2) && r2 > -5 && r2 <= 1 ? r2 : undefined;
  for (const [target, metrics] of Object.entries(bundle.metrics.skater)) {
    const r2 = sane(metrics.r2);
    if (r2 !== undefined) out[target as SkaterCategory] = r2;
  }
  for (const [target, metrics] of Object.entries(bundle.metrics.goalie)) {
    const r2 = sane(metrics.r2);
    if (r2 !== undefined) out[target as GoalieCategory] = r2;
  }
  return out;
}

function positionRosterWeight(
  position: Position,
  league: LeagueSettings,
): number {
  if (position === "G") return league.roster.G;
  return league.roster[position as keyof typeof league.roster] ?? 0;
}

/**
 * Replacement and elite production for a category, pooled across roster slots.
 * Elite = average of top half of starters at each position; replacement = player
 * at the last rosterable rank when sorted by that stat within the position pool.
 */
function replacementAndElite(
  players: PlayerLike[],
  category: Category,
  league: LeagueSettings,
  leagueSavePct: number,
): { replacement: number; elite: number } {
  const positions: Position[] = ["C", "LW", "RW", "D", "G"];
  let replSum = 0;
  let eliteSum = 0;
  let weightSum = 0;

  for (const position of positions) {
    // Defensemen aren't scored on faceoffs; their all-zero pool would dilute
    // the scarcity signal.
    if (category === "faceoffWins" && position === "D") continue;
    const slotWeight = positionRosterWeight(position, league);
    if (slotWeight <= 0) continue;

    const pool = players.filter((p) => p.positions.includes(position));
    if (pool.length === 0) continue;

    const sorted = [...pool].sort(
      (a, b) =>
        statValue(b.projection, category, leagueSavePct) -
        statValue(a.projection, category, leagueSavePct),
    );
    const rank = replacementRank(
      position as keyof LeagueSettings["roster"],
      league.teams,
      league.roster,
    );
    const replIdx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    const replacement = statValue(sorted[replIdx].projection, category, leagueSavePct);

    const starterCount = Math.min(rank, sorted.length);
    const eliteSlice = sorted.slice(0, Math.max(1, Math.floor(starterCount / 2)));
    const elite = mean(
      eliteSlice.map((p) => statValue(p.projection, category, leagueSavePct)),
    );

    replSum += replacement * slotWeight;
    eliteSum += elite * slotWeight;
    weightSum += slotWeight;
  }

  return {
    replacement: weightSum > 0 ? replSum / weightSum : 0,
    elite: weightSum > 0 ? eliteSum / weightSum : 0,
  };
}

function computeGroupWeights<C extends string>(
  players: PlayerLike[],
  categories: readonly C[],
  league: LeagueSettings,
  r2Map: Partial<Record<Category, number>>,
  useConcentration: boolean,
): Record<C, CategoryDifficultyMeta> {
  const raw: Record<string, CategoryDifficultyMeta> = {};
  const leagueSavePct = leagueAverageSavePct(
    players.filter((p) => p.isGoalie).map((p) => p.projection as GoalieProjection),
  );

  for (const category of categories) {
    const group =
      category === "faceoffWins"
        ? players.filter((p) => !p.positions.includes("D"))
        : players;
    const values = group.map((p) =>
      statValue(p.projection, category as Category, leagueSavePct),
    );
    const avg = mean(values);
    const sd = stdDev(values);
    // std/mean is undefined for zero-centered stats (saves above average);
    // fall back to a neutral 1 so the weight is driven by scarcity alone.
    const cv = avg > 1e-6 ? sd / avg : 1;

    const { replacement, elite } = replacementAndElite(
      players,
      category as Category,
      league,
      leagueSavePct,
    );
    const gap = Math.max(0, elite - replacement);
    const scarcity = gap / Math.max(sd, 1e-6);

    // Production concentration: how few players generate the stat. Faceoffs are
    // only taken by centers, so measure their concentration among centers —
    // including wingers with ~0 would fake scarcity from a positional zero.
    const producePool =
      category === "faceoffWins"
        ? players.filter((p) => p.positions.includes("C"))
        : group;
    const g = gini(
      producePool.map((p) => statValue(p.projection, category as Category, leagueSavePct)),
    );

    // Skater difficulty = production concentration (Gini): few big producers →
    // hard to produce → scarce. Goalies keep the elite/replacement scarcity
    // measure (savePct is signed saves-above-average, where Gini is undefined).
    const rawDifficulty = useConcentration
      ? Math.max(g, 1e-3)
      : scarcity * Math.sqrt(Math.max(cv, 0.05));

    const r2 = r2Map[category as Category] ?? null;
    // Slight boost for predictable skill stats; dampen noisy categories (e.g. PIM).
    const skillFactor = r2 != null ? 0.75 + 0.25 * Math.max(0, Math.min(1, r2)) : 1;

    raw[category] = {
      weight: rawDifficulty * skillFactor,
      scarcity,
      cv,
      gini: g,
      r2,
      replacementLevel: replacement,
      eliteLevel: elite,
    };
  }

  const avgWeight =
    categories.reduce((s, c) => s + raw[c].weight, 0) / Math.max(1, categories.length);

  const result = {} as Record<C, CategoryDifficultyMeta>;
  for (const category of categories) {
    const meta = raw[category];
    const normalized = avgWeight > 0 ? meta.weight / avgWeight : 1;
    const tilted = 1 + SCARCITY_TILT * (normalized - 1);
    result[category] = {
      ...meta,
      weight: Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, tilted)),
    };
  }
  return result;
}

export function computeCategoryDifficultyWeights(
  players: PlayerLike[],
  league: LeagueSettings = DEFAULT_LEAGUE,
): CategoryDifficultyWeights {
  const r2Map = mlR2ByCategory();
  const skaters = players.filter((p) => !p.isGoalie);
  const goalies = players.filter((p) => p.isGoalie);

  return {
    skater: computeGroupWeights(skaters, SKATER_CATEGORIES, league, r2Map, true),
    goalie: computeGroupWeights(goalies, GOALIE_CATEGORIES, league, r2Map, false),
  };
}

export function categoryWeight(
  weights: CategoryDifficultyWeights,
  category: Category,
  isGoalie: boolean,
): number {
  if (isGoalie) {
    return weights.goalie[category as GoalieCategory]?.weight ?? 1;
  }
  return weights.skater[category as SkaterCategory]?.weight ?? 1;
}
