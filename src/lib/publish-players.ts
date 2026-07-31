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

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Shrink float noise in the board JSON without changing sort order meaningfully. */
export function compactBoardNumbers(p: PlayerProjection): PlayerProjection {
  const categoryZScores: PlayerProjection["categoryZScores"] = {};
  for (const [k, v] of Object.entries(p.categoryZScores ?? {})) {
    if (typeof v === "number" && Number.isFinite(v)) {
      categoryZScores[k as keyof typeof categoryZScores] = round3(v);
    }
  }
  const uncertainty = p.uncertainty
    ? {
        ...p.uncertainty,
        gamesPlayedSigma: round3(p.uncertainty.gamesPlayedSigma),
        aleatoricShare: round3(p.uncertainty.aleatoricShare),
        total: {
          sigma: round3(p.uncertainty.total.sigma),
          modelSpread: round3(p.uncertainty.total.modelSpread),
          aleatoric: round3(p.uncertainty.total.aleatoric),
        },
      }
    : undefined;
  return {
    ...p,
    categoryZScores,
    fantasyValue: round3(p.fantasyValue),
    vor: round3(p.vor),
    ...(p.vorByPosition
      ? {
          vorByPosition: Object.fromEntries(
            Object.entries(p.vorByPosition).map(([k, v]) => [
              k,
              typeof v === "number" ? round3(v) : v,
            ]),
          ) as PlayerProjection["vorByPosition"],
        }
      : {}),
    ...(uncertainty ? { uncertainty } : {}),
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
  } = compactBoardNumbers(p);
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
