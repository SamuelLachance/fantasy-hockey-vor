import type {
  Category,
  PlayerProjection,
  ProjectionUncertainty,
  StatUncertainty,
} from "@/lib/types";

export interface PlayerDetailRecord {
  reasoning: string;
  profileSummary: string;
  /** Per-stat 1σ totals for expand UI (numbers only — no modelSpread blob). */
  perStatSigma?: Partial<Record<Category, number>>;
  /**
   * @deprecated Prefer perStatSigma. Kept so older detail files still parse.
   */
  perStatUncertainty?: Partial<Record<Category, StatUncertainty>>;
  marketEdge?: Partial<Record<Category, number>>;
}

/** Resolve per-stat σ from slim or legacy detail shapes. */
export function detailStatSigma(
  detail: PlayerDetailRecord | undefined,
  cat: Category,
): number | undefined {
  if (!detail) return undefined;
  const slim = detail.perStatSigma?.[cat];
  if (slim != null) return slim;
  return detail.perStatUncertainty?.[cat]?.sigma;
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
    const perStatSigma: Partial<Record<Category, number>> = {};
    for (const [cat, u] of Object.entries(uncertainty.perStat)) {
      if (u?.sigma != null) perStatSigma[cat as Category] = u.sigma;
    }
    if (Object.keys(perStatSigma).length > 0) detail.perStatSigma = perStatSigma;
  }
  if (marketEdge && Object.keys(marketEdge).length > 0) {
    detail.marketEdge = marketEdge;
  }
  return { board, detail };
}
