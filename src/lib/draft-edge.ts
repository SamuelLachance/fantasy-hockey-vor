import { clampSkaterProjection } from "./projection-sanity";
import { applyVor, type VorResult } from "./vor";
import type {
  Category,
  LeagueSettings,
  PlayerProjection,
} from "./types";

type Rankable = Omit<
  PlayerProjection,
  "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
> &
  Partial<
    Pick<
      PlayerProjection,
      "categoryZScores" | "fantasyValue" | "vor" | "rank" | "positionRank"
    >
  >;

/** Rebuild synthetic-market totals from model − per-game edge. */
export function marketProjectionFromEdge<T extends Rankable>(player: T): T {
  if (player.isGoalie || !player.marketEdge) return player;
  const edge = player.marketEdge;
  const gp = Math.max(1, player.gamesPlayed);
  const proj = player.projection as unknown as Record<string, number>;
  const uncapped = {
    goals: Math.max(0, (proj.goals / gp - (edge.goals ?? 0)) * gp),
    assists: Math.max(0, (proj.assists / gp - (edge.assists ?? 0)) * gp),
    shots: Math.max(0, (proj.shots / gp - (edge.shots ?? 0)) * gp),
    blocks: Math.max(0, (proj.blocks / gp - (edge.blocks ?? 0)) * gp),
    hits: Math.max(0, (proj.hits / gp - (edge.hits ?? 0)) * gp),
    powerplayPoints: Math.max(
      0,
      (proj.powerplayPoints / gp - (edge.powerplayPoints ?? 0)) * gp,
    ),
    penaltyMinutes: Math.max(
      0,
      (proj.penaltyMinutes / gp - (edge.penaltyMinutes ?? 0)) * gp,
    ),
    faceoffWins: Math.max(
      0,
      (proj.faceoffWins / gp - (edge.faceoffWins ?? 0)) * gp,
    ),
  };
  return {
    ...player,
    projection: clampSkaterProjection(uncapped as never, gp, player.position),
  };
}

/**
 * Attach syntheticMarketRank / draftValue using the same draftable baselines
 * as the model VOR pass (apples-to-apples Edge).
 */
export function attachDraftEdge(
  ranked: PlayerProjection[],
  raw: Rankable[],
  league: LeagueSettings,
  vorMeta: Pick<
    VorResult,
    "categoryWeights" | "replacementLevels" | "draftableIds"
  >,
): void {
  const draftableIdSet = new Set(vorMeta.draftableIds);
  const modelDraftable = raw.filter((p) => draftableIdSet.has(p.id));
  const marketRaw = raw.map((p) => marketProjectionFromEdge(p));
  const { players: marketRanked } = applyVor(marketRaw, league, {
    categoryWeights: vorMeta.categoryWeights,
    replacementLevels: vorMeta.replacementLevels,
    zReference: modelDraftable,
  });
  const marketRankById = new Map<number, number>();
  for (const p of marketRanked) marketRankById.set(p.id, p.rank);
  for (const p of ranked) {
    if (p.isGoalie || !p.marketEdge) {
      p.syntheticMarketRank = p.rank;
      p.draftValue = 0;
    } else {
      p.syntheticMarketRank = marketRankById.get(p.id) ?? p.rank;
      p.draftValue = p.syntheticMarketRank - p.rank;
    }
  }
}

/** Categories that contribute to market-edge reconstruction. */
export const MARKET_EDGE_CATEGORIES: Category[] = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
];
