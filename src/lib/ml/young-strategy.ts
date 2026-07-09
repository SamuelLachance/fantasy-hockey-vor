import { priorNhlSeasons } from "./features";
import type { PlayerSeasonRow, ProductionStrategy, RidgeModel } from "./types";
import { LOW_HISTORY_MAX_PRIOR_SEASONS } from "./types";
import {
  rookieRatePerGame,
} from "./contextual-baseline";

export function defaultYoungStrategy(target: string): ProductionStrategy {
  if (target === "penaltyMinutes" || target === "hits") {
    return { type: "contextual_only" };
  }
  if (target === "goals") {
    return { type: "ml_contextual_ensemble", mlContextualWeight: 0.08 };
  }
  if (target === "assists") {
    return { type: "ewma_only" };
  }
  return { type: "ml_contextual_ensemble", mlContextualWeight: 0.15 };
}

/** True rookies — no prior NHL seasons with GP≥10. */
export function tier0Strategy(target: string): ProductionStrategy {
  if (target === "penaltyMinutes" || target === "hits") {
    return { type: "lag1_only" };
  }
  if (target === "blocks") {
    return { type: "contextual_only" };
  }
  if (target === "goals") {
    return { type: "contextual_only" };
  }
  if (target === "assists") {
    return { type: "ewma_only" };
  }
  return { type: "ml_contextual_ensemble", mlContextualWeight: 0.08 };
}

/** One prior NHL season — heavy persistence, minimal ML. */
export function tier1Strategy(target: string): ProductionStrategy {
  if (target === "penaltyMinutes" || target === "hits") {
    return { type: "ewma_only" };
  }
  if (target === "goals") {
    return {
      type: "ml_contextual_ensemble",
      mlContextualWeight: 0.06,
      blendWeights: { ml: 0.08, ewma: 0.75, lag1: 0.17 },
    };
  }
  if (target === "assists") {
    return { type: "ewma_only" };
  }
  return { type: "ml_contextual_ensemble", mlContextualWeight: 0.1 };
}

export function resolveProductionStrategy(
  model: RidgeModel,
  prior: PlayerSeasonRow[],
): ProductionStrategy {
  const n = priorNhlSeasons(prior);
  if (n > LOW_HISTORY_MAX_PRIOR_SEASONS) {
    return (
      model.productionStrategy ?? {
        type: "tuned_blend",
        blendWeights: model.blendWeights ?? {
          ml: 1 - (model.ewmaBlendWeight ?? 0.85),
          ewma: model.ewmaBlendWeight ?? 0.85,
          lag1: 0,
        },
      }
    );
  }
  const tierTargets = new Set(["hits", "penaltyMinutes", "blocks"]);
  if (n === 0 && tierTargets.has(model.target)) return tier0Strategy(model.target);
  if (n === 1 && tierTargets.has(model.target)) return tier1Strategy(model.target);
  if (model.lowHistoryStrategy) return model.lowHistoryStrategy;
  if (model.productionStrategy?.type === "ml_only") {
    return defaultYoungStrategy(model.target);
  }
  return defaultYoungStrategy(model.target);
}

/** Offensive wingers with low block history — use cohort prior instead of ML. */
export function applyBlocksRoleFilter(
  rate: number,
  position: string,
  prior: PlayerSeasonRow[],
  contextual: number,
): number {
  if (position !== "LW" && position !== "RW") return rate;
  const last = prior.filter((r) => r.gamesPlayed >= 10).at(-1);
  if (!last) return rate;
  const blockRate = last.blocks / Math.max(1, last.gamesPlayed);
  if (blockRate < 0.55) {
    const cohort = rookieRatePerGame(position, "blocks");
    return contextual * 0.65 + cohort * 0.35;
  }
  return rate;
}
