import type { PlayerProfile } from "../profile-types";
import {
  projectGoalieFromProfile,
  projectSkaterFromProfile,
} from "../contextual-projections";
import {
  anchorSkaterProjectionToHistory,
  clampGoalieProjection,
  clampSkaterProjection,
} from "../projection-sanity";
import { projectedGamesFromProfile, type GoalieRole } from "../projection-gp";
import { isCenterEligible } from "../yahoo-positions";
import type { GoalieProjection, SkaterProjection } from "../types";
import {
  buildGoalieGpInferenceFeatures,
  buildSkaterGpInferenceFeatures,
  buildTargetInferenceFeatures,
  extractEwmaFeature,
  extractLag1Feature,
  priorNhlSeasons,
} from "./features";
import { loadContextCaches } from "./enrich-rows";
import {
  buildProjectionTargetRow,
  profileToSeasonRows,
} from "./inference-context";
import { applyBlendWeights, predictRidge } from "./ridge";
import type { MlModelBundle, PlayerSeasonRow, ProductionStrategy, RidgeModel } from "./types";
import { LOW_HISTORY_MAX_PRIOR_SEASONS, SKATER_ML_TARGETS } from "./types";
import { loadMlModels } from "./train";
import { contextualPerGameRateFromRows } from "./contextual-baseline";

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];
const CONTEXTUAL_BASELINE_R2 = 0.55;

function ewmaPerGameRate(
  history: PlayerSeasonRow[],
  stat: (row: PlayerSeasonRow) => number,
): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10).slice(-3);
  if (eligible.length === 0) return 0;
  const weights = EWMA_WEIGHTS.slice(-eligible.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return eligible.reduce((sum, row, i) => {
    const rate = row.gamesPlayed > 0 ? stat(row) / row.gamesPlayed : 0;
    return sum + rate * (weights[i] / totalW);
  }, 0);
}

function rowStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

function resolveSkaterModel(
  models: MlModelBundle,
  target: string,
  position: PlayerProfile["position"],
): RidgeModel | undefined {
  const group = position === "D" ? "D" : "F";
  const candidates = models.skaterModels.filter((m) => m.target === target);
  return (
    candidates.find((m) => m.positionGroup === group) ??
    candidates.find((m) => !m.positionGroup || m.positionGroup === "all")
  );
}

function mlWeightForTarget(models: MlModelBundle, target: string): number {
  const r2 = models.metrics.skater[target]?.r2 ?? 0.5;
  const mlW = Math.max(0.35, Math.min(0.92, r2));
  const contextualW = Math.max(0.08, CONTEXTUAL_BASELINE_R2);
  return mlW / (mlW + contextualW);
}

function contextualPerGameRates(
  profile: PlayerProfile,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
): Record<string, number> {
  if (priorNhlSeasons(history) <= LOW_HISTORY_MAX_PRIOR_SEASONS) {
    const rates: Record<string, number> = {};
    for (const target of SKATER_ML_TARGETS) {
      rates[target] = contextualPerGameRateFromRows(
        history,
        targetRow,
        target,
      );
    }
    return rates;
  }

  const contextual = projectSkaterFromProfile(profile);
  const gp = Math.max(1, contextual.gamesPlayed);
  const p = contextual.projection;
  return {
    goals: p.goals / gp,
    assists: p.assists / gp,
    shots: p.shots / gp,
    blocks: p.blocks / gp,
    hits: p.hits / gp,
    powerplayPoints: p.powerplayPoints / gp,
    penaltyMinutes: p.penaltyMinutes / gp,
    faceoffWins: p.faceoffWins / gp,
  };
}

function defaultYoungStrategy(target: string): ProductionStrategy {
  if (target === "penaltyMinutes" || target === "hits") {
    return { type: "contextual_only" };
  }
  if (target === "goals" || target === "assists") {
    return { type: "ml_contextual_ensemble", mlContextualWeight: 0.05 };
  }
  return { type: "ml_contextual_ensemble", mlContextualWeight: 0.15 };
}

function resolveProductionStrategy(
  model: RidgeModel,
  prior: PlayerSeasonRow[],
): ProductionStrategy {
  if (priorNhlSeasons(prior) <= LOW_HISTORY_MAX_PRIOR_SEASONS) {
    if (model.lowHistoryStrategy) {
      return model.lowHistoryStrategy;
    }
    if (model.productionStrategy?.type === "ml_only") {
      return defaultYoungStrategy(model.target);
    }
  }
  return (
    model.productionStrategy ?? {
      type: "tuned_blend" as const,
      blendWeights: model.blendWeights ?? {
        ml: 1 - (model.ewmaBlendWeight ?? 0.85),
        ewma: model.ewmaBlendWeight ?? 0.85,
        lag1: 0,
      },
    }
  );
}

function applyProductionStrategy(
  strategy: ProductionStrategy,
  ml: number,
  ewma: number,
  lag1: number,
  contextual: number,
): number {
  switch (strategy.type) {
    case "ml_only":
      return Math.max(0, ml);
    case "ewma_only":
      return Math.max(0, ewma > 0 ? ewma : lag1);
    case "lag1_only":
      return Math.max(0, lag1 > 0 ? lag1 : ewma);
    case "tuned_blend": {
      const w = strategy.blendWeights ?? { ml: 0.15, ewma: 0.7, lag1: 0.15 };
      const [blended] = applyBlendWeights([ml], [ewma], [lag1], w);
      return blended;
    }
    case "contextual_only":
      return Math.max(0, contextual);
    case "ml_contextual_ensemble": {
      const w = strategy.blendWeights ?? { ml: 0.15, ewma: 0.7, lag1: 0.15 };
      const [blended] = applyBlendWeights([ml], [ewma], [lag1], w);
      const mlShare = strategy.mlContextualWeight ?? 0.65;
      return Math.max(0, blended * mlShare + contextual * (1 - mlShare));
    }
    default:
      return Math.max(0, ml);
  }
}

function predictRateForTarget(
  profile: PlayerProfile,
  models: MlModelBundle,
  target: string,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
  contextualRates: Record<string, number> | null,
): number {
  const model = resolveSkaterModel(models, target, profile.position);
  if (!model) return 0;

  const { features, featureNames } = buildTargetInferenceFeatures(
    history,
    target,
    false,
    targetRow,
  );
  const ml = Math.max(0, predictRidge(model, features));
  const ewma = extractEwmaFeature(featureNames, features, target);
  const lag1 = extractLag1Feature(featureNames, features, target);
  const historyEwma = ewmaPerGameRate(history, (r) => rowStat(r, target));
  const ewmaRate = ewma > 0 ? ewma : historyEwma;
  const ctxRate = contextualRates?.[target] ?? ewmaRate;

  const strategy = resolveProductionStrategy(model, history);

  if (strategy.type === "ml_contextual_ensemble" && contextualRates) {
    const mlShare =
      strategy.mlContextualWeight ?? mlWeightForTarget(models, target);
    const w = strategy.blendWeights ?? model.blendWeights;
    let mlRate: number;
    if (w) {
      const [blended] = applyBlendWeights([ml], [ewmaRate], [lag1], w);
      mlRate = blended;
    } else {
      mlRate = ewmaRate > 0 ? ewmaRate * 0.85 + ml * 0.15 : ml;
    }
    return mlRate * mlShare + ctxRate * (1 - mlShare);
  }

  if (strategy.type === "contextual_only" && contextualRates) {
    return ctxRate;
  }

  return applyProductionStrategy(strategy, ml, ewmaRate, lag1, ctxRate);
}

function predictSkaterGp(
  profile: PlayerProfile,
  models: MlModelBundle,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
): number | null {
  if (!models.skaterGpModel) return null;
  const { features } = buildSkaterGpInferenceFeatures(history, targetRow);
  const gp = predictRidge(models.skaterGpModel, features);
  return Math.max(10, Math.min(82, Math.round(gp)));
}

function predictGoalieGp(
  profile: PlayerProfile,
  models: MlModelBundle,
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
): number | null {
  if (!models.goalieGpModel) return null;
  const goalieHistory = history.filter((r) => r.isGoalie);
  const { features } = buildGoalieGpInferenceFeatures(goalieHistory, targetRow);
  const gp = predictRidge(models.goalieGpModel, features);
  return Math.max(10, Math.min(82, Math.round(gp)));
}

export function projectSkaterWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
  blendContextual = true,
): { projection: SkaterProjection; gamesPlayed: number; reasoning: string } {
  const caches = loadContextCaches();
  const history = profileToSeasonRows(profile, caches).filter((r) => !r.isGoalie);
  const targetRow = buildProjectionTargetRow(profile, caches);
  const mlGp = predictSkaterGp(profile, models, history, targetRow);
  const gamesPlayed = projectedGamesFromProfile(profile, undefined, mlGp, {
    skaterGpStrategy: models.skaterGpStrategy ?? "ensemble",
    skaterGpLag1EwmaBlend: models.skaterGpLag1EwmaBlend,
    skaterGpEnsembleWeights: models.skaterGpEnsembleWeights,
    skaterGpTwoStepConfig: models.skaterGpTwoStepConfig,
  });

  const contextualRates = blendContextual
    ? contextualPerGameRates(profile, history, targetRow)
    : null;

  const rates: Record<string, number> = {};
  const champions: string[] = [];
  for (const target of SKATER_ML_TARGETS) {
    if (target === "faceoffWins" && !isCenterEligible(profile)) {
      rates[target] = 0;
      continue;
    }
    const model = resolveSkaterModel(models, target, profile.position);
    rates[target] = predictRateForTarget(
      profile,
      models,
      target,
      history,
      targetRow,
      contextualRates,
    );
    if (model?.productionStrategy) {
      champions.push(`${target}:${model.productionStrategy.type}`);
    }
  }

  const raw = clampSkaterProjection(
    {
      goals: Math.round(rates.goals * gamesPlayed),
      assists: Math.round(rates.assists * gamesPlayed),
      shots: Math.round(rates.shots * gamesPlayed),
      blocks: Math.round(rates.blocks * gamesPlayed),
      hits: Math.round(rates.hits * gamesPlayed),
      powerplayPoints: Math.round(rates.powerplayPoints * gamesPlayed),
      penaltyMinutes: Math.round(rates.penaltyMinutes * gamesPlayed),
      faceoffWins: Math.round(rates.faceoffWins * gamesPlayed),
    },
    gamesPlayed,
    profile.position,
  );

  const projection = anchorSkaterProjectionToHistory(profile, raw, gamesPlayed);

  const gpStrategy = models.skaterGpStrategy ?? "ensemble";
  const gpNote =
    gpStrategy === "injury_only"
      ? "injury-profile GP"
      : gpStrategy === "ml_only"
        ? `ML GP (${mlGp})`
        : `injury+ML GP (${gpStrategy}, ml=${mlGp})`;

  return {
    projection,
    gamesPlayed,
    reasoning: `Per-stat champion strategies + ${gpNote}; EB-anchored PIM/hits/blocks`,
  };
}

export function projectGoalieWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
  goalieRoleMap?: Map<number, GoalieRole>,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const caches = loadContextCaches();
  const history = profileToSeasonRows(profile, caches);
  const targetRow = buildProjectionTargetRow(profile, caches);
  const mlGp = predictGoalieGp(profile, models, history, targetRow);
  const result = projectGoalieFromProfile(profile, goalieRoleMap);
  const gamesPlayed = projectedGamesFromProfile(profile, goalieRoleMap, null, {
    goalieGpStrategy: models.goalieGpStrategy ?? "ensemble",
    goalieGpLag1EwmaBlend: models.goalieGpLag1EwmaBlend,
    goalieGpEnsembleWeights: models.goalieGpEnsembleWeights,
    goalieGpTwoStepConfig: models.goalieGpTwoStepConfig,
    goalieMlGp: mlGp,
  });

  const oldGp = Math.max(1, result.gamesPlayed);
  const scale = gamesPlayed / oldGp;
  const projection = clampGoalieProjection(
    {
      wins: Math.round(result.projection.wins * scale),
      shutouts: Math.round(result.projection.shutouts * scale),
      saves: Math.round(result.projection.saves * scale),
      savePct: result.projection.savePct,
    },
    gamesPlayed,
  );

  const gpStrategy = models.goalieGpStrategy ?? "ensemble";
  return {
    projection,
    gamesPlayed,
    reasoning: `Goalie MoneyPuck GSAx + team SV% environment; GP=${gamesPlayed} (${gpStrategy})`,
  };
}

export function getMlModels(): MlModelBundle | null {
  return loadMlModels();
}
