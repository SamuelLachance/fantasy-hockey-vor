import type {
  Category,
  PlayerProjection,
  ProjectionUncertainty,
  StatUncertainty,
} from "@/lib/types";

export interface PlayerDetailRecord {
  reasoning: string;
  profileSummary: string;
  /** Full per-stat σ — kept out of the table payload. */
  perStatUncertainty?: Partial<Record<Category, StatUncertainty>>;
  marketEdge?: Partial<Record<Category, number>>;
}

/** Summary uncertainty for the board (no perStat blob). */
export function slimUncertainty(
  u: ProjectionUncertainty | undefined,
): ProjectionUncertainty | undefined {
  if (!u) return undefined;
  return {
    gamesPlayedSigma: u.gamesPlayedSigma,
    total: u.total,
    aleatoricShare: u.aleatoricShare,
  };
}

/**
 * Split a ranked player into table row + lazy detail payload.
 * Drops unused-on-board marketEdge and per-stat uncertainty from the main JSON.
 */
export function splitPublishedPlayer(p: PlayerProjection): {
  board: PlayerProjection;
  detail: PlayerDetailRecord;
} {
  const {
    reasoning,
    profileSummary,
    marketEdge,
    uncertainty,
    ...rest
  } = p;
  const board: PlayerProjection = {
    ...rest,
    ...(uncertainty ? { uncertainty: slimUncertainty(uncertainty) } : {}),
  };
  const detail: PlayerDetailRecord = {
    reasoning: reasoning ?? "",
    profileSummary: profileSummary ?? "",
  };
  if (uncertainty?.perStat && Object.keys(uncertainty.perStat).length > 0) {
    detail.perStatUncertainty = uncertainty.perStat;
  }
  if (marketEdge && Object.keys(marketEdge).length > 0) {
    detail.marketEdge = marketEdge;
  }
  return { board, detail };
}
