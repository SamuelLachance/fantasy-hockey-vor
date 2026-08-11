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
 * equal weights are the principled baseline — and since v2 of the VOR layer
 * they are also (almost) the actual weights. Scarcity-proportional tilts
 * double-count: the elite-vs-replacement gap in sd units is exactly the
 * z-score gap the fantasy value already sums. The one tilt kept is
 * predictability (holdout R² per category), shrunk halfway toward 1 and
 * clamped, then renormalized so the mean weight stays 1. Scarcity, CV and
 * Gini are still computed and exported as informational metadata.
 */
const SCARCITY_TILT = 0.5;
const WEIGHT_MIN = 0.7;
const WEIGHT_MAX = 1.4;

/**
 * Gini coefficient over the full draftable group (zeros included).
 * 0 = perfectly even; → 1 = one player produces everything. Including zeros
 * correctly marks sparse stats (few producers) as more concentrated.
 */
function gini(values: number[]): number {
  const xs = values
    .map((v) => (Number.isFinite(v) && v > 0 ? v : 0))
    .sort((a, b) => a - b);
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

/**
 * Production concentration (Gini) measured inside each position pool, then
 * slot-weighted. Measured on a mixed pool, position mix masquerades as
 * scarcity: blocks looked concentrated (gini 0.30 > assists 0.17) only
 * because defensemen produce them and forwards don't, which tilted weights
 * toward peripherals and against assists. Faceoffs stay center-scoped.
 */
function positionConcentration(
  players: PlayerLike[],
  category: Category,
  league: LeagueSettings,
  leagueSavePct: number,
): number {
  const positions: Position[] =
    category === "faceoffWins" ? ["C"] : ["C", "LW", "RW", "D"];
  let sum = 0;
  let wSum = 0;
  for (const position of positions) {
    const slotWeight = positionRosterWeight(position, league);
    if (slotWeight <= 0) continue;
    const pool = players.filter((p) => p.positions.includes(position));
    if (pool.length < 2) continue;
    const g = gini(
      pool.map((p) => statValue(p.projection, category, leagueSavePct)),
    );
    sum += g * slotWeight;
    wSum += slotWeight;
  }
  return wSum > 0 ? sum / wSum : 0;
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

    // Production concentration: how few players generate the stat, measured
    // within position pools so positional zeros never fake scarcity.
    const g = useConcentration
      ? positionConcentration(players, category as Category, league, leagueSavePct)
      : gini(
          group.map((p) =>
            statValue(p.projection, category as Category, leagueSavePct),
          ),
        );

    // Scarcity/concentration stay exported as informational meta, but the
    // weight itself no longer tilts on them: the elite-vs-replacement gap in
    // sd units *is* the z-score gap, so a scarcity-proportional weight counts
    // the same signal twice (value ∝ z × w(z-gap)). Measured cleanly within
    // position pools, the concentration signal also inverted the design
    // intent (hits read as scarcer than goals). In H2H every category is one
    // matchup point — equal weights are the principled baseline; the only
    // tilt kept is predictability (holdout R²), which is independent of the
    // z spread.
    const rawDifficulty = 1;

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

  const tilted: Record<string, number> = {};
  for (const category of categories) {
    const meta = raw[category];
    const normalized = avgWeight > 0 ? meta.weight / avgWeight : 1;
    tilted[category] = Math.min(
      WEIGHT_MAX,
      Math.max(WEIGHT_MIN, 1 + SCARCITY_TILT * (normalized - 1)),
    );
  }
  // Clamp and "mean weight = 1" are two invariants applied in sequence, so a
  // single renormalization pass can push a clamped weight back outside
  // [WEIGHT_MIN, WEIGHT_MAX]. Alternate them until both hold (converges in a
  // few passes; the clamp is the authoritative bound if they ever can't).
  for (let pass = 0; pass < 8; pass++) {
    const m =
      categories.reduce((s, c) => s + tilted[c], 0) / Math.max(1, categories.length);
    if (!(m > 0)) break;
    let outOfBand = false;
    for (const category of categories) {
      const scaled = tilted[category] / m;
      const clamped = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, scaled));
      if (Math.abs(clamped - scaled) > 1e-12) outOfBand = true;
      tilted[category] = clamped;
    }
    if (!outOfBand && Math.abs(m - 1) < 1e-9) break;
  }

  const result = {} as Record<C, CategoryDifficultyMeta>;
  for (const category of categories) {
    const meta = raw[category];
    result[category] = {
      ...meta,
      weight: tilted[category],
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
