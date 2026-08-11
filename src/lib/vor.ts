import { leagueAverageSavePct, savesAboveAverage } from "./goalie-impact";
import { DEFAULT_LEAGUE, draftablePoolSize, replacementRank } from "./league";
import {
  categoryWeight,
  computeCategoryDifficultyWeights,
  type CategoryDifficultyWeights,
} from "./stat-difficulty";
import {
  DEFENSE_SKATER_CATEGORIES,
  GOALIE_CATEGORIES,
  SKATER_CATEGORIES,
  type Category,
  type GoalieProjection,
  type LeagueSettings,
  type PlayerProjection,
  type Position,
  type SkaterProjection,
} from "./types";

type RawPlayer = Omit<
  PlayerProjection,
  "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
>;

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

function zScore(value: number, avg: number, sd: number): number {
  if (!Number.isFinite(value)) return 0;
  return (value - avg) / sd;
}

function getStat(
  projection: SkaterProjection | GoalieProjection,
  category: Category,
): number {
  return (
    (projection as unknown as Record<string, number>)[category] ?? 0
  );
}

/**
 * Per-position means and the pooled within-position standard deviation for
 * one category over a reference pool.
 *
 * Why within-position: every fantasy team fields the same position quotas
 * (2C/2LW/2RW/4D), so the position-mix of category production is common to
 * all teams and cancels in weekly matchups — what decides categories is
 * *which* C/LW/RW/D you started. A mixed-pool sd is inflated by the
 * between-position gap for position-skewed stats (goals: F≈30 vs D≈9;
 * blocks: D≈93 vs F≈36), which crushed forward-vs-forward scoring
 * separation ~2.4× while denting D-vs-D peripheral separation only ~1.5×,
 * systematically inflating defensemen. Group means with a pooled residual
 * sd keep z units comparable across positions on the team-relevant scale.
 */
function withinPositionStats(
  refPool: RawPlayer[],
  getValue: (p: RawPlayer) => number,
): { means: Map<Position, number>; sd: number; overallMean: number } {
  const groups = new Map<Position, number[]>();
  for (const p of refPool) {
    const v = getValue(p);
    if (!Number.isFinite(v)) continue;
    const list = groups.get(p.position) ?? [];
    list.push(v);
    groups.set(p.position, list);
  }
  const means = new Map<Position, number>();
  let ssq = 0;
  let n = 0;
  let sum = 0;
  for (const [pos, vals] of groups) {
    const m = mean(vals);
    means.set(pos, m);
    for (const v of vals) {
      ssq += (v - m) ** 2;
      n += 1;
      sum += v;
    }
  }
  const sd = n > 1 ? Math.sqrt(ssq / (n - 1)) || 1 : 1;
  return { means, sd, overallMean: n > 0 ? sum / n : 0 };
}

/**
 * Z-scores for every player in `players`, measured against the distribution
 * of `reference` (defaults to the full pool). Passing the draftable pool as
 * the reference keeps hundreds of near-zero fringe players from distorting
 * category means and spreads.
 *
 * Skater categories are scored against the player's own position group
 * (mean per position, spread pooled within positions — see
 * `withinPositionStats`), so a winger taking no faceoffs is not punished
 * for a positional zero and defensemen aren't subsidized by a mixed-pool
 * spread. Goalies are already their own group.
 *
 * savePct is scored as saves above the reference pool's shots-weighted
 * average SV%, so its z reflects volume-weighted team impact rather than a
 * raw rate that a low-workload backup can top.
 */
export function computeCategoryZScores(
  players: RawPlayer[],
  reference: RawPlayer[] = players,
): Map<number, Partial<Record<Category, number>>> {
  const skaters = players.filter((p) => !p.isGoalie);
  const goalies = players.filter((p) => p.isGoalie);
  const refSkaters = reference.filter((p) => !p.isGoalie);
  const refGoalies = reference.filter((p) => p.isGoalie);
  const result = new Map<number, Partial<Record<Category, number>>>();

  for (const category of SKATER_CATEGORIES) {
    // Defensemen aren't scored on faceoffs — keep them out of both the
    // distribution and the scoring for that category.
    const pool =
      category === "faceoffWins"
        ? skaters.filter((p) => p.position !== "D")
        : skaters;
    const refPool =
      category === "faceoffWins"
        ? refSkaters.filter((p) => p.position !== "D")
        : refSkaters;
    const { means, sd, overallMean } = withinPositionStats(refPool, (p) =>
      getStat(p.projection as SkaterProjection, category),
    );

    for (const player of pool) {
      const value = getStat(player.projection as SkaterProjection, category);
      const avg = means.get(player.position) ?? overallMean;
      const scores = result.get(player.id) ?? {};
      scores[category] = zScore(value, avg, sd);
      result.set(player.id, scores);
    }
  }

  const leagueSavePct = leagueAverageSavePct(
    refGoalies.map((p) => p.projection as GoalieProjection),
  );
  const goalieStat = (player: RawPlayer, category: Category): number =>
    category === "savePct"
      ? savesAboveAverage(player.projection as GoalieProjection, leagueSavePct)
      : getStat(player.projection as GoalieProjection, category);

  for (const category of GOALIE_CATEGORIES) {
    const values = refGoalies.map((p) => goalieStat(p, category));
    const avg = mean(values);
    const sd = stdDev(values);

    for (const player of goalies) {
      const scores = result.get(player.id) ?? {};
      scores[category] = zScore(goalieStat(player, category), avg, sd);
      result.set(player.id, scores);
    }
  }

  return result;
}

/**
 * KNOWN LIMITATION: the category set comes from the primary position, so a
 * player eligible at both D and a forward slot would carry a D-scored
 * (7-category) value into forward pools and vice versa. Yahoo currently
 * lists no D+forward dual-eligible players, so the case is unreachable; if
 * one appears, score per-position values against per-position replacement.
 */
/**
 * Peripheral counting cats: extreme outliers (200+ hits/blocks) should not
 * outrank elite scorers in a balanced H2H categories league. Soft-cap with
 * tanh so ranking within peripherals is preserved but contribution saturates.
 */
const PERIPHERAL_SOFT_CAP_Z = 2.75;
const PERIPHERAL_CATEGORIES = new Set<Category>([
  "hits",
  "blocks",
  "penaltyMinutes",
]);

export function softCapCategoryZ(category: Category, z: number): number {
  if (!PERIPHERAL_CATEGORIES.has(category) || !Number.isFinite(z)) return z;
  return PERIPHERAL_SOFT_CAP_Z * Math.tanh(z / PERIPHERAL_SOFT_CAP_Z);
}

export function fantasyValueFromZScores(
  zScores: Partial<Record<Category, number>>,
  isGoalie: boolean,
  difficultyWeights?: CategoryDifficultyWeights,
  position?: Position,
): number {
  const categories: readonly Category[] = isGoalie
    ? GOALIE_CATEGORIES
    : position === "D"
      ? DEFENSE_SKATER_CATEGORIES
      : SKATER_CATEGORIES;
  return categories.reduce((sum, cat) => {
    const z = softCapCategoryZ(cat, zScores[cat] ?? 0);
    const w = difficultyWeights
      ? categoryWeight(difficultyWeights, cat, isGoalie)
      : 1;
    return sum + (Number.isFinite(z) ? z * w : 0);
  }, 0);
}

export interface VorResult {
  players: PlayerProjection[];
  categoryWeights: CategoryDifficultyWeights;
  replacementLevels: Partial<Record<Position, number>>;
  draftableIds: number[];
}

export function computeReplacementLevels(
  players: PlayerProjection[],
  league: LeagueSettings = DEFAULT_LEAGUE,
): Partial<Record<Position, number>> {
  const levels: Partial<Record<Position, number>> = {};
  const positions: Position[] = ["C", "LW", "RW", "D", "G"];

  for (const position of positions) {
    const pool = players
      .filter((p) => p.positions.includes(position))
      .sort((a, b) => b.fantasyValue - a.fantasyValue);

    const rank = replacementRank(
      position as keyof LeagueSettings["roster"],
      league.teams,
      league.roster,
    );
    const replacement = pool[Math.min(rank - 1, pool.length - 1)];
    levels[position] = replacement?.fantasyValue ?? 0;
  }

  return levels;
}

function bestVorPosition(
  fantasyValue: number,
  positions: Position[],
  replacementLevels: Partial<Record<Position, number>>,
): { vor: number; position: Position } {
  let bestVor = -Infinity;
  let bestPosition = positions[0] ?? "C";

  for (const position of positions) {
    const replacement = replacementLevels[position] ?? 0;
    const vor = fantasyValue - replacement;
    if (vor > bestVor) {
      bestVor = vor;
      bestPosition = position;
    }
  }

  return { vor: Number.isFinite(bestVor) ? bestVor : 0, position: bestPosition };
}

type ValuedPlayer = RawPlayer & {
  categoryZScores: Partial<Record<Category, number>>;
  fantasyValue: number;
  vor: number;
};

function computeFantasyValues(
  players: RawPlayer[],
  zScores: Map<number, Partial<Record<Category, number>>>,
  goalieFactor: number,
  difficultyWeights?: CategoryDifficultyWeights,
): ValuedPlayer[] {
  return players.map((player) => {
    const categoryZScores = zScores.get(player.id) ?? {};
    const value = fantasyValueFromZScores(
      categoryZScores,
      player.isGoalie,
      difficultyWeights,
      player.position,
    );
    const fantasyValue = player.isGoalie ? value * goalieFactor : value;
    return { ...player, categoryZScores, fantasyValue, vor: 0 };
  });
}

/** Ids of the top draftable players at each position by fantasy value. */
function selectDraftableIds(
  players: ValuedPlayer[],
  league: LeagueSettings,
): Set<number> {
  const ids = new Set<number>();
  const positions: Position[] = ["C", "LW", "RW", "D", "G"];

  for (const position of positions) {
    const pool = players
      .filter((p) => p.positions.includes(position))
      .sort((a, b) => b.fantasyValue - a.fantasyValue);
    const size = draftablePoolSize(
      position as keyof LeagueSettings["roster"],
      league.teams,
      league.roster,
    );
    for (const player of pool.slice(0, size)) ids.add(player.id);
  }

  return ids;
}

export interface VorBaselines {
  categoryWeights: CategoryDifficultyWeights;
  replacementLevels: Partial<Record<Position, number>>;
  /**
   * Draftable-pool projections used as the z-score reference distribution.
   * For synthetic-market Edge, pass the *model* draftable rows so market
   * totals are scored against the same category means/SDs as the model rank.
   */
  zReference: RawPlayer[];
}

export function applyVor(
  players: RawPlayer[],
  league: LeagueSettings = DEFAULT_LEAGUE,
  /** When set, skip pass-1 pool selection and reuse prior scarcity/replacement. */
  reuse?: VorBaselines,
): VorResult {
  const goalieFactor = league.goalieVorFactor ?? 1;

  let categoryWeights: CategoryDifficultyWeights;
  let replacementLevels: Partial<Record<Position, number>>;
  let draftable: RawPlayer[];
  let withValues: ValuedPlayer[];

  if (reuse) {
    // Synthetic-market Edge: score alternate projections against the *same*
    // draftable baselines as the model ranking (skip pass-1 pool selection;
    // Edge isn't polluted by a second independent pool / mean-SD).
    if (reuse.zReference.length === 0) {
      return applyVor(players, league);
    }
    draftable = reuse.zReference;
    categoryWeights = reuse.categoryWeights;
    const zScores = computeCategoryZScores(players, draftable);
    withValues = computeFantasyValues(
      players,
      zScores,
      goalieFactor,
      categoryWeights,
    );
    replacementLevels = reuse.replacementLevels;
  } else {
    // Pass 1: unweighted z-scores over the full pool, only to identify the
    // draftable pool at each position.
    const passOne = computeFantasyValues(
      players,
      computeCategoryZScores(players),
      goalieFactor,
    );
    const draftableIds = selectDraftableIds(passOne, league);
    draftable = players.filter((p) => draftableIds.has(p.id));

    // Pass 2: scarcity weights and z-score baselines come from the draftable
    // pool; every player is then scored against those baselines.
    categoryWeights = computeCategoryDifficultyWeights(draftable, league);
    const zScores = computeCategoryZScores(players, draftable);
    withValues = computeFantasyValues(
      players,
      zScores,
      goalieFactor,
      categoryWeights,
    );

    replacementLevels = computeReplacementLevels(
      withValues as PlayerProjection[],
      league,
    );
  }

  const withVor = withValues.map((player) => {
    const eligible = player.positions.length > 0 ? player.positions : [player.position];
    const vorByPosition = Object.fromEntries(
      eligible.map((pos) => [
        pos,
        player.fantasyValue - (replacementLevels[pos] ?? 0),
      ]),
    ) as Partial<Record<Position, number>>;

    const { vor, position } = bestVorPosition(
      player.fantasyValue,
      eligible,
      replacementLevels,
    );
    // `position` becomes the VOR slot; remember the position the projection
    // was built at so re-clamping never applies another slot's rate limits.
    const primaryPosition = player.primaryPosition ?? player.position;
    return {
      ...player,
      vor,
      position,
      primaryPosition,
      vorPosition: position,
      vorByPosition,
    };
  });

  const sorted = [...withVor].sort((a, b) => b.vor - a.vor);

  const positionCounters: Partial<Record<Position, number>> = {};

  const draftableIds = draftable.map((p) => p.id);

  // Rank at *every* eligible position, ordered by that position's own VOR.
  // The position-filtered board needs the rank for the filter it is showing:
  // a C+LW player whose best slot is LW would otherwise carry his LW rank
  // onto the C tab, duplicating rank numbers there.
  const positionRanks = new Map<number, Partial<Record<Position, number>>>();
  for (const position of ["C", "LW", "RW", "D", "G"] as Position[]) {
    const eligible = withVor
      .filter((p) =>
        (p.positions.length > 0 ? p.positions : [p.position]).includes(position),
      )
      .sort(
        (a, b) =>
          (b.vorByPosition?.[position] ?? b.vor) -
          (a.vorByPosition?.[position] ?? a.vor),
      );
    eligible.forEach((p, i) => {
      const entry = positionRanks.get(p.id) ?? {};
      entry[position] = i + 1;
      positionRanks.set(p.id, entry);
    });
  }

  return {
    players: sorted.map((player, index) => {
      const posCount = (positionCounters[player.position] ?? 0) + 1;
      positionCounters[player.position] = posCount;
      return {
        ...player,
        rank: index + 1,
        positionRank: posCount,
        positionRanks: positionRanks.get(player.id) ?? {},
      };
    }),
    categoryWeights,
    replacementLevels,
    draftableIds,
  };
}
