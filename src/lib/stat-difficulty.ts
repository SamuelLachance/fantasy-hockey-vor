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
  /** Normalized weight used in fantasy value (mean ≈ 1). */
  weight: number;
  /** Elite vs replacement gap divided by league std. */
  scarcity: number;
  /** Coefficient of variation (std / mean). */
  cv: number;
  /** Holdout R² from ML models when available. */
  r2: number | null;
  replacementLevel: number;
  eliteLevel: number;
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
      (a, b) => getStat(b.projection, category) - getStat(a.projection, category),
    );
    const rank = replacementRank(
      position as keyof LeagueSettings["roster"],
      league.teams,
      league.roster,
    );
    const replIdx = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    const replacement = getStat(sorted[replIdx].projection, category);

    const starterCount = Math.min(rank, sorted.length);
    const eliteSlice = sorted.slice(0, Math.max(1, Math.floor(starterCount / 2)));
    const elite = mean(eliteSlice.map((p) => getStat(p.projection, category)));

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
): Record<C, CategoryDifficultyMeta> {
  const raw: Record<string, CategoryDifficultyMeta> = {};

  for (const category of categories) {
    const group =
      category === "faceoffWins"
        ? players.filter((p) => !p.positions.includes("D"))
        : players;
    const values = group.map((p) => getStat(p.projection, category as Category));
    const avg = mean(values);
    const sd = stdDev(values);
    const cv = avg > 0 ? sd / avg : sd;

    const { replacement, elite } = replacementAndElite(
      players,
      category as Category,
      league,
    );
    const gap = Math.max(0, elite - replacement);
    const scarcity = gap / Math.max(sd, 1e-6);

    // Harder-to-generate stats: wider elite/replacement gap and higher relative spread.
    const rawDifficulty = scarcity * Math.sqrt(Math.max(cv, 0.05));

    const r2 = r2Map[category as Category] ?? null;
    // Slight boost for predictable skill stats; dampen noisy categories (e.g. PIM).
    const skillFactor = r2 != null ? 0.75 + 0.25 * Math.max(0, Math.min(1, r2)) : 1;

    raw[category] = {
      weight: rawDifficulty * skillFactor,
      scarcity,
      cv,
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
    result[category] = {
      ...meta,
      weight: avgWeight > 0 ? meta.weight / avgWeight : 1,
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
    skater: computeGroupWeights(skaters, SKATER_CATEGORIES, league, r2Map),
    goalie: computeGroupWeights(goalies, GOALIE_CATEGORIES, league, r2Map),
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
