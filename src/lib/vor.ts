import { DEFAULT_LEAGUE, replacementRank } from "./league";
import {
  GOALIE_CATEGORIES,
  SKATER_CATEGORIES,
  type Category,
  type GoalieProjection,
  type LeagueSettings,
  type PlayerProjection,
  type Position,
  type SkaterProjection,
} from "./types";

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

export function computeCategoryZScores(
  players: Omit<PlayerProjection, "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank">[],
): Map<number, Partial<Record<Category, number>>> {
  const skaters = players.filter((p) => !p.isGoalie);
  const goalies = players.filter((p) => p.isGoalie);
  const result = new Map<number, Partial<Record<Category, number>>>();

  for (const category of SKATER_CATEGORIES) {
    const values = skaters.map((p) =>
      getStat(p.projection as SkaterProjection, category),
    );
    const avg = mean(values);
    const sd = stdDev(values);

    for (const player of skaters) {
      const value = getStat(player.projection as SkaterProjection, category);
      const scores = result.get(player.id) ?? {};
      scores[category] = zScore(value, avg, sd);
      result.set(player.id, scores);
    }
  }

  for (const category of GOALIE_CATEGORIES) {
    const values = goalies.map((p) =>
      getStat(p.projection as GoalieProjection, category),
    );
    const avg = mean(values);
    const sd = stdDev(values);

    for (const player of goalies) {
      const value = getStat(player.projection as GoalieProjection, category);
      const scores = result.get(player.id) ?? {};
      scores[category] = zScore(value, avg, sd);
      result.set(player.id, scores);
    }
  }

  return result;
}

export function fantasyValueFromZScores(
  zScores: Partial<Record<Category, number>>,
  isGoalie: boolean,
): number {
  const categories = isGoalie ? GOALIE_CATEGORIES : SKATER_CATEGORIES;
  return categories.reduce((sum, cat) => {
    const z = zScores[cat] ?? 0;
    return sum + (Number.isFinite(z) ? z : 0);
  }, 0);
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

export function applyVor(
  players: Omit<
    PlayerProjection,
    "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
  >[],
  league: LeagueSettings = DEFAULT_LEAGUE,
): PlayerProjection[] {
  const zScores = computeCategoryZScores(players);

  const withValues = players.map((player) => {
    const categoryZScores = zScores.get(player.id) ?? {};
    const fantasyValue = fantasyValueFromZScores(
      categoryZScores,
      player.isGoalie,
    );
    return { ...player, categoryZScores, fantasyValue, vor: 0 };
  });

  const replacementLevels = computeReplacementLevels(
    withValues as PlayerProjection[],
    league,
  );

  const withVor = withValues.map((player) => {
    const replacement = replacementLevels[player.position] ?? 0;
    return { ...player, vor: player.fantasyValue - replacement };
  });

  const sorted = [...withVor].sort((a, b) => b.vor - a.vor);

  const positionCounters: Partial<Record<Position, number>> = {};

  return sorted.map((player, index) => {
    const posCount = (positionCounters[player.position] ?? 0) + 1;
    positionCounters[player.position] = posCount;
    return {
      ...player,
      rank: index + 1,
      positionRank: posCount,
    };
  });
}
