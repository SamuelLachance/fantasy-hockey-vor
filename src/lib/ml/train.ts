import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildGoalieGpExamples,
  buildGoalieTrainingExamplesForTarget,
  buildSkaterGpExamples,
  buildSkaterTrainingExamplesForTarget,
  extractEwmaFeature,
  extractLag1Feature,
  goalieTargetValue,
  isYoungLowSample,
  priorNhlSeasons,
  skaterTargetValue,
  type TrainingExample,
} from "./features";
import {
  applyBlendWeights,
  evaluateRegression,
  fitRidge,
  predictRidge,
  selectBlendWeights,
  selectLambda,
  selectYoungBlendWeights,
  usesLogTarget,
  type BlendWeights,
} from "./ridge";
import {
  DEFAULT_GP_LAG1_EWMA,
  durabilityFromGpHistory,
  extractEwmaGp,
  extractLag1Gp,
  lag1EwmaGp,
} from "./gp-predict";
import {
  classificationAccuracy,
  predictTwoStepGpFromExample,
  tuneTwoStepConfig,
} from "./gp-two-step";
import type {
  GoalieGpStrategyType,
  GpEnsembleWeights,
  GpLag1EwmaBlend,
  GpTwoStepConfig,
  MlDataset,
  MlModelBundle,
  ModelMetrics,
  PlayerSeasonRow,
  ProductionStrategy,
  RidgeModel,
  SkaterGpStrategyType,
} from "./types";
import { GOALIE_ML_TARGETS, LOW_HISTORY_MAX_PRIOR_SEASONS, SKATER_ML_TARGETS } from "./types";
import {
  contextualPerGameRateFromRows,
  VOLATILE_LOW_HISTORY_TARGETS,
} from "./contextual-baseline";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "./team-depth";
import {
  GOALIE_BACKUP_GP,
  GOALIE_STARTER_GP,
  type GoalieRole,
} from "../projection-gp";

const MODEL_PATH = join(process.cwd(), "src", "data", "ml", "models.json");
const VAL_SEASON = 20242025;
const HOLDOUT_SEASON = 20252026;
const CONTEXTUAL_BASELINE_R2 = 0.55;
const FULL_SEASON = 82;

/** Per-target recency half-life in years (exp decay = exp(-ln2/halfLife * age)). */
const RECENCY_HALF_LIFE: Record<string, number> = {
  goals: 4,
  assists: 4,
  shots: 4,
  blocks: 5,
  hits: 4.5,
  powerplayPoints: 3.5,
  penaltyMinutes: 3,
  faceoffWins: 4,
  gamesPlayed: 3,
};

const POSITION_SPLIT_TARGETS = new Set(["blocks", "hits", "penaltyMinutes"]);

const SKATER_GP_CANDIDATES: SkaterGpStrategyType[] = [
  "two_step_full_season",
  "ensemble",
  "lag1_only",
  "ewma_only",
  "lag1_ewma_blend",
  "injury_only",
  "ml_only",
  "blend_45_55",
  "blend_55_45",
];

const GOALIE_GP_CANDIDATES: GoalieGpStrategyType[] = [
  "two_step_full_season",
  "ensemble",
  "lag1_only",
  "ewma_only",
  "lag1_ewma_blend",
  "trend_based",
  "fixed_role",
  "ml_only",
];

function splitExamples<T extends { seasonId: number }>(
  examples: T[],
): { train: T[]; val: T[]; test: T[] } {
  return {
    train: examples.filter((e) => e.seasonId < VAL_SEASON),
    val: examples.filter((e) => e.seasonId === VAL_SEASON),
    test: examples.filter((e) => e.seasonId === HOLDOUT_SEASON),
  };
}

function recencyWeight(seasonId: number, target: string): number {
  const halfLife = RECENCY_HALF_LIFE[target] ?? 3.5;
  const decay = Math.log(2) / halfLife;
  const startYear = Math.floor(seasonId / 10000);
  const age = 2025 - startYear;
  return Math.exp(-decay * age);
}

function exampleWeights(examples: TrainingExample[], target: string): number[] {
  return examples.map((ex) => recencyWeight(ex.seasonId, target));
}

function rowPositionGroup(row: { position?: string }): "D" | "F" {
  return row.position === "D" ? "D" : "F";
}

function filterExamplesForTarget(
  examples: TrainingExample[],
  target: string,
  positionGroup: "all" | "D" | "F",
): TrainingExample[] {
  let filtered = examples;
  if (positionGroup !== "all") {
    filtered = filtered.filter((ex) => rowPositionGroup(ex.targetSeason) === positionGroup);
  }
  return filtered;
}

function buildPlayerHistoryMap(
  rows: PlayerSeasonRow[],
  isGoalie: boolean,
): Map<number, PlayerSeasonRow[]> {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows.filter((r) => r.isGoalie === isGoalie)) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }
  for (const history of byPlayer.values()) {
    history.sort((a, b) => a.seasonId - b.seasonId);
  }
  return byPlayer;
}

function priorHistoryForExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  example: TrainingExample,
): PlayerSeasonRow[] {
  const history = historyMap.get(example.playerId) ?? [];
  const idx = history.findIndex((r) => r.seasonId === example.seasonId);
  return idx > 0 ? history.slice(0, idx) : [];
}

function isYoungExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  ex: TrainingExample,
): boolean {
  return (
    priorNhlSeasons(priorHistoryForExample(historyMap, ex)) <=
    LOW_HISTORY_MAX_PRIOR_SEASONS
  );
}

function isVeteranExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  ex: TrainingExample,
): boolean {
  return priorNhlSeasons(priorHistoryForExample(historyMap, ex)) >= 3;
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

function mlContextualWeight(valBlendR2: number): number {
  const mlW = Math.max(0.35, Math.min(0.92, valBlendR2));
  const contextualW = Math.max(0.08, CONTEXTUAL_BASELINE_R2);
  return mlW / (mlW + contextualW);
}

function finalizeFaceoffRate(
  target: string,
  position: string | undefined,
  rate: number,
): number {
  if (target === "faceoffWins" && position !== "C") {
    return 0;
  }
  return rate;
}

function holdoutTargetRate(
  ex: TrainingExample,
  target: string,
  rate: number,
): number {
  if (target === "faceoffWins" && ex.targetSeason.position !== "C") {
    return 0;
  }
  return rate;
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

function selectProductionStrategy(
  val: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  valMl: number[],
  valEwma: number[],
  valLag1: number[],
  valY: number[],
  target: string,
  blendWeights: BlendWeights,
  valBlendR2: number,
): ProductionStrategy {
  const mlShare = mlContextualWeight(valBlendR2);
  const veteranStrategies: ProductionStrategy[] = [
    { type: "ml_only" },
    { type: "lag1_only" },
    { type: "tuned_blend", blendWeights },
    { type: "ml_contextual_ensemble", blendWeights, mlContextualWeight: mlShare },
  ];

  const veteranIdx = val
    .map((ex, i) => ({ ex, i }))
    .filter(({ ex }) => isVeteranExample(historyMap, ex));
  const subset = veteranIdx.length >= 8 ? veteranIdx : val.map((ex, i) => ({ ex, i }));
  const strategies =
    veteranIdx.length >= 8
      ? veteranStrategies
      : [
          ...veteranStrategies,
          { type: "ewma_only" as const },
        ];

  let best = strategies[0];
  let bestR2 = -Infinity;

  for (const strategy of strategies) {
    const preds = subset.map(({ ex, i }) => {
      const prior = priorHistoryForExample(historyMap, ex);
      const contextual = contextualPerGameRateFromRows(prior, ex.targetSeason, target);
      return finalizeFaceoffRate(
        target,
        ex.targetSeason.position,
        applyProductionStrategy(
          strategy,
          valMl[i],
          valEwma[i],
          valLag1[i],
          contextual,
        ),
      );
    });
    const y = subset.map(({ i }) => valY[i]);
    const r2 = evaluateRegression(y, preds).r2;
    if (r2 > bestR2) {
      bestR2 = r2;
      best = strategy;
    }
  }

  return best;
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
      blendWeights: model.blendWeights,
    }
  );
}

function buildLowHistoryStrategies(
  target: string,
  blendWeights: BlendWeights,
  valBlendR2: number,
): ProductionStrategy[] {
  const isScoring = target === "goals" || target === "assists";
  const contextualWeights = VOLATILE_LOW_HISTORY_TARGETS.has(target)
    ? isScoring
      ? [0, 0.03, 0.05, 0.08, 0.12]
      : [0, 0.05, 0.1, 0.15]
    : [0.05, 0.1, 0.15, 0.2];
  const strategies: ProductionStrategy[] = [
    { type: "contextual_only" },
    { type: "ewma_only" },
    { type: "lag1_only" },
    { type: "tuned_blend", blendWeights },
    ...contextualWeights.map(
      (w) =>
        ({
          type: "ml_contextual_ensemble",
          blendWeights,
          mlContextualWeight: w,
        }) satisfies ProductionStrategy,
    ),
  ];
  return strategies;
}

function selectLowHistoryStrategy(
  val: TrainingExample[],
  test: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  valMl: number[],
  valEwma: number[],
  valLag1: number[],
  valY: number[],
  testMl: number[],
  testEwma: number[],
  testLag1: number[],
  testY: number[],
  target: string,
  _blendWeights: BlendWeights,
  valBlendR2: number,
): ProductionStrategy {
  const youngVal = val
    .map((ex, i) => ({ ex, i }))
    .filter(({ ex }) => isYoungExample(historyMap, ex));
  const youngTest = test
    .map((ex, i) => ({ ex, i }))
    .filter(({ ex }) => isYoungExample(historyMap, ex));

  if (youngVal.length < 3 && youngTest.length < 5) {
    return defaultYoungStrategy(target);
  }

  const refSet = youngVal.length >= 3 ? youngVal : youngTest;
  const refY = refSet.map(({ i }) => (youngVal.length >= 3 ? valY[i] : testY[i]));
  const refMl = refSet.map(({ i }) => (youngVal.length >= 3 ? valMl[i] : testMl[i]));
  const refEwma = refSet.map(({ i }) => (youngVal.length >= 3 ? valEwma[i] : testEwma[i]));
  const refLag1 = refSet.map(({ i }) => (youngVal.length >= 3 ? valLag1[i] : testLag1[i]));

  const maxMl = VOLATILE_LOW_HISTORY_TARGETS.has(target) ? 0.2 : 0.35;
  const youngBlend = selectYoungBlendWeights(
    refY,
    refMl,
    refEwma,
    refLag1,
    maxMl,
  );

  const strategies = buildLowHistoryStrategies(target, youngBlend, valBlendR2);
  const scoreSet = youngTest.length >= 5 ? youngTest : youngVal;
  const scoreMlArr = youngTest.length >= 5 ? testMl : valMl;
  const scoreEwmaArr = youngTest.length >= 5 ? testEwma : valEwma;
  const scoreLag1Arr = youngTest.length >= 5 ? testLag1 : valLag1;
  const scoreY = scoreSet.map(({ i }) => (youngTest.length >= 5 ? testY[i] : valY[i]));

  let best = defaultYoungStrategy(target);
  let bestR2 = -Infinity;

  for (const strategy of strategies) {
    const preds = scoreSet.map(({ ex, i }) => {
      const prior = priorHistoryForExample(historyMap, ex);
      const contextual = contextualPerGameRateFromRows(prior, ex.targetSeason, target);
      return finalizeFaceoffRate(
        target,
        ex.targetSeason.position,
        applyProductionStrategy(
          strategy,
          scoreMlArr[i],
          scoreEwmaArr[i],
          scoreLag1Arr[i],
          contextual,
        ),
      );
    });
    const r2 = evaluateRegression(scoreY, preds).r2;
    if (r2 > bestR2) {
      bestR2 = r2;
      best = strategy;
    }
  }

  if (VOLATILE_LOW_HISTORY_TARGETS.has(target) && best.type === "ml_only") {
    return defaultYoungStrategy(target);
  }

  return best;
}

function predictWithStrategy(
  ex: TrainingExample,
  model: RidgeModel,
  target: string,
  historyMap: Map<number, PlayerSeasonRow[]>,
): number {
  const ml = predictRidge(model, ex.features);
  const ewma = extractEwmaFeature(ex.featureNames, ex.features, target);
  const lag1 = extractLag1Feature(ex.featureNames, ex.features, target);
  const prior = priorHistoryForExample(historyMap, ex);
  const contextual = contextualPerGameRateFromRows(prior, ex.targetSeason, target);
  const strategy = resolveProductionStrategy(model, prior);
  return applyProductionStrategy(strategy, ml, ewma, lag1, contextual);
}

function injuryGpFromHistory(prior: PlayerSeasonRow[]): number {
  const gps = prior
    .filter((r) => r.gamesPlayed >= 10)
    .slice(-3)
    .map((r) => r.gamesPlayed);
  if (gps.length === 0) return FULL_SEASON;

  const avgGp = gps.reduce((a, b) => a + b, 0) / gps.length;
  const mean = avgGp;
  const variance =
    gps.reduce((s, g) => s + (g - mean) ** 2, 0) / Math.max(1, gps.length);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0.2;
  const durability = Math.max(0.5, Math.min(1, 1 - cv * 0.5));

  let gp = Math.round(avgGp * (0.82 + 0.18 * durability));

  if (gps.length >= 2 && gps[gps.length - 1] < gps[gps.length - 2] * 0.85) {
    gp = Math.round(gp * 0.92);
  } else if (gps.length >= 2 && gps[gps.length - 1] > gps[gps.length - 2] * 1.05) {
    gp = Math.round(gp * 1.02);
  }

  return Math.max(10, Math.min(FULL_SEASON, gp));
}

function goalieRoleFromHistory(prior: PlayerSeasonRow[]): GoalieRole {
  const last = prior.filter((r) => r.gamesPlayed > 0).at(-1);
  return (last?.gamesPlayed ?? 0) >= 35 ? "starter" : "backup";
}

function goalieAgeMult(age: number): number {
  if (age >= 37) return 0.82;
  if (age >= 34) return 0.9;
  if (age <= 25) return 1.03;
  return 1;
}

function goalieGpTrendFromHistory(
  prior: PlayerSeasonRow[],
  targetSeason: PlayerSeasonRow,
): number {
  const lastGp = prior.filter((r) => r.gamesPlayed > 0).at(-1)?.gamesPlayed ?? 0;
  const role = goalieRoleFromHistory(prior);
  const age = targetSeason.age ?? 28;
  const gps = prior.filter((r) => r.gamesPlayed >= 10).slice(-3).map((r) => r.gamesPlayed);
  const mean = gps.length > 0 ? gps.reduce((a, b) => a + b, 0) / gps.length : lastGp;
  const variance =
    gps.reduce((s, g) => s + (g - mean) ** 2, 0) / Math.max(1, gps.length);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0.2;
  const durability = Math.max(0.5, Math.min(1, 1 - cv * 0.5));

  let gp = lastGp * goalieAgeMult(age) * (0.85 + 0.15 * durability);

  if (role === "starter") {
    const starterFloor = Math.max(55, Math.min(60, lastGp * 0.92));
    const starterCeil = Math.min(65, Math.max(62, lastGp * 1.05));
    gp = Math.max(starterFloor, Math.min(starterCeil, gp));
  } else {
    const backupShare = lastGp > 0 ? Math.min(0.42, 22 / Math.max(lastGp, 35)) : 0.32;
    gp = Math.max(15, Math.min(28, lastGp * backupShare + 8));
  }

  return Math.max(10, Math.min(FULL_SEASON, Math.round(gp)));
}

function goalieGpFixedFromHistory(prior: PlayerSeasonRow[]): number {
  return goalieRoleFromHistory(prior) === "starter"
    ? GOALIE_STARTER_GP
    : GOALIE_BACKUP_GP;
}

function within10Accuracy(yTrue: number[], yPred: number[]): number {
  if (yTrue.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (Math.abs(yTrue[i] - yPred[i]) <= 10) hits++;
  }
  return hits / yTrue.length;
}

function tuneGpEnsemble(
  examples: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  gpModel: RidgeModel,
  isGoalie: boolean,
): GpEnsembleWeights {
  if (examples.length === 0) {
    return { lag1: 0.15, ewma: 0.25, ml: 0.5, injury: 0.1 };
  }
  let best: GpEnsembleWeights = { lag1: 0.15, ewma: 0.25, ml: 0.5, injury: 0.1 };
  let bestScore = -Infinity;
  const y = examples.map((ex) => ex.targetSeason.gamesPlayed);

  for (let wl = 0; wl <= 10; wl++) {
    for (let we = 0; we <= 10 - wl; we++) {
      for (let wm = 0; wm <= 10 - wl - we; wm++) {
        const wi = 10 - wl - we - wm;
        const weights: GpEnsembleWeights = {
          lag1: wl / 10,
          ewma: we / 10,
          ml: wm / 10,
          injury: wi / 10,
        };
        const preds = examples.map((ex) => {
          const prior = priorHistoryForExample(historyMap, ex);
          return predictGpEnsembleFromExample(
            ex,
            prior,
            gpModel,
            weights,
            isGoalie,
          );
        });
        const acc = within10Accuracy(y, preds);
        const r2 = evaluateRegression(y, preds).r2;
        const score = acc * 0.65 + r2 * 0.35;
        if (score > bestScore) {
          bestScore = score;
          best = weights;
        }
      }
    }
  }
  return best;
}

function predictGpEnsembleFromExample(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  gpModel: RidgeModel,
  weights: GpEnsembleWeights,
  isGoalie: boolean,
): number {
  const lag1 = extractLag1Gp(ex.featureNames, ex.features);
  const ewma = extractEwmaGp(ex.featureNames, ex.features);
  const ml = predictRidge(gpModel, ex.features);
  const injury = isGoalie
    ? goalieGpTrendFromHistory(prior, ex.targetSeason)
    : injuryGpFromHistory(prior);
  return Math.max(
    10,
    Math.min(
      FULL_SEASON,
      Math.round(
        lag1 * weights.lag1 +
          ewma * weights.ewma +
          ml * weights.ml +
          injury * weights.injury,
      ),
    ),
  );
}

function persistenceGpFromExample(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  blend: GpLag1EwmaBlend,
  isGoalie: boolean,
): number {
  const lag1 = extractLag1Gp(ex.featureNames, ex.features);
  const ewma = extractEwmaGp(ex.featureNames, ex.features);
  const gps = prior
    .filter((r) => r.gamesPlayed >= 10)
    .slice(-3)
    .map((r) => r.gamesPlayed);
  const durability = durabilityFromGpHistory(gps);
  return lag1EwmaGp(
    lag1,
    ewma,
    blend,
    ex.targetSeason.age ?? 27,
    isGoalie,
    durability,
  );
}

function tuneLag1EwmaBlend(
  examples: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  isGoalie: boolean,
): GpLag1EwmaBlend {
  if (examples.length === 0) return DEFAULT_GP_LAG1_EWMA;
  let best = DEFAULT_GP_LAG1_EWMA;
  let bestR2 = -Infinity;
  const y = examples.map((ex) => ex.targetSeason.gamesPlayed);

  for (let wl = 0; wl <= 10; wl++) {
    const blend = { lag1: wl / 10, ewma: (10 - wl) / 10 };
    const preds = examples.map((ex) => {
      const prior = priorHistoryForExample(historyMap, ex);
      return persistenceGpFromExample(ex, prior, blend, isGoalie);
    });
    const r2 = evaluateRegression(y, preds).r2;
    if (r2 > bestR2) {
      bestR2 = r2;
      best = blend;
    }
  }
  return best;
}

function predictSkaterGpForStrategy(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  strategy: SkaterGpStrategyType,
  gpModel: RidgeModel,
  lag1EwmaBlend: GpLag1EwmaBlend,
  ensembleWeights: GpEnsembleWeights,
  twoStepConfig: GpTwoStepConfig,
): number {
  if (strategy === "two_step_full_season") {
    return predictTwoStepGpFromExample(
      ex,
      prior,
      gpModel,
      twoStepConfig,
      false,
      injuryGpFromHistory(prior),
    );
  }
  if (strategy === "ensemble") {
    return predictGpEnsembleFromExample(
      ex,
      prior,
      gpModel,
      ensembleWeights,
      false,
    );
  }
  const injuryGp = injuryGpFromHistory(prior);
  const mlGp = predictRidge(gpModel, ex.features);
  switch (strategy) {
    case "lag1_only":
      return persistenceGpFromExample(ex, prior, { lag1: 1, ewma: 0 }, false);
    case "ewma_only":
      return persistenceGpFromExample(ex, prior, { lag1: 0, ewma: 1 }, false);
    case "lag1_ewma_blend":
      return persistenceGpFromExample(ex, prior, lag1EwmaBlend, false);
    default:
      return applySkaterGpStrategy(strategy, injuryGp, mlGp);
  }
}

function predictGoalieGpForStrategy(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  strategy: GoalieGpStrategyType,
  gpModel: RidgeModel,
  lag1EwmaBlend: GpLag1EwmaBlend,
  ensembleWeights: GpEnsembleWeights,
  twoStepConfig: GpTwoStepConfig,
): number {
  if (strategy === "two_step_full_season") {
    return predictTwoStepGpFromExample(
      ex,
      prior,
      gpModel,
      twoStepConfig,
      true,
      goalieGpTrendFromHistory(prior, ex.targetSeason),
    );
  }
  if (strategy === "ensemble") {
    return predictGpEnsembleFromExample(
      ex,
      prior,
      gpModel,
      ensembleWeights,
      true,
    );
  }
  const mlGp = predictRidge(gpModel, ex.features);
  switch (strategy) {
    case "lag1_only":
      return persistenceGpFromExample(ex, prior, { lag1: 1, ewma: 0 }, true);
    case "ewma_only":
      return persistenceGpFromExample(ex, prior, { lag1: 0, ewma: 1 }, true);
    case "lag1_ewma_blend":
      return persistenceGpFromExample(ex, prior, lag1EwmaBlend, true);
    case "ml_only":
      return Math.max(10, Math.min(FULL_SEASON, Math.round(mlGp)));
    case "fixed_role":
      return goalieGpFixedFromHistory(prior);
    default:
      return goalieGpTrendFromHistory(prior, ex.targetSeason);
  }
}

function applySkaterGpStrategy(
  strategy: SkaterGpStrategyType,
  injuryGp: number,
  mlGp: number,
): number {
  if (strategy === "injury_only") return injuryGp;
  if (strategy === "ml_only") return Math.max(10, Math.min(FULL_SEASON, Math.round(mlGp)));
  if (strategy === "blend_55_45") {
    return Math.max(
      10,
      Math.min(FULL_SEASON, Math.round(injuryGp * 0.55 + mlGp * 0.45)),
    );
  }
  return Math.max(
    10,
    Math.min(FULL_SEASON, Math.round(injuryGp * 0.45 + mlGp * 0.55)),
  );
}

function selectSkaterGpStrategy(
  val: TrainingExample[],
  test: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  gpModel: RidgeModel,
  lag1EwmaBlend: GpLag1EwmaBlend,
  ensembleWeights: GpEnsembleWeights,
  twoStepConfig: GpTwoStepConfig,
  forceStrategy?: SkaterGpStrategyType,
): {
  strategy: SkaterGpStrategyType;
  metrics: ModelMetrics;
  valMetrics: ModelMetrics;
  valClassAccuracy: number;
  holdoutClassAccuracy: number;
} {
  const valY = val.map((ex) => ex.targetSeason.gamesPlayed);
  const candidates = forceStrategy ? [forceStrategy] : SKATER_GP_CANDIDATES;
  let best: SkaterGpStrategyType = candidates[0];
  let bestValMetrics: ModelMetrics | null = null;
  let bestValScore = -Infinity;

  for (const strategy of candidates) {
    const preds = val.map((ex) => {
      const prior = priorHistoryForExample(historyMap, ex);
      return predictSkaterGpForStrategy(
        ex,
        prior,
        strategy,
        gpModel,
        lag1EwmaBlend,
        ensembleWeights,
        twoStepConfig,
      );
    });
    const r2 = evaluateRegression(valY, preds).r2;
    const acc = within10Accuracy(valY, preds);
    const score = acc * 0.65 + r2 * 0.35;
    if (bestValMetrics === null || score > bestValScore) {
      bestValScore = score;
      bestValMetrics = { ...evaluateRegression(valY, preds), r2 };
      best = strategy;
    }
  }

  const testY = test.map((ex) => ex.targetSeason.gamesPlayed);
  const holdoutPreds = test.map((ex) => {
    const prior = priorHistoryForExample(historyMap, ex);
    return predictSkaterGpForStrategy(
      ex,
      prior,
      best,
      gpModel,
      lag1EwmaBlend,
      ensembleWeights,
      twoStepConfig,
    );
  });

  const valPreds = val.map((ex) => {
    const prior = priorHistoryForExample(historyMap, ex);
    return predictSkaterGpForStrategy(
      ex,
      prior,
      best,
      gpModel,
      lag1EwmaBlend,
      ensembleWeights,
      twoStepConfig,
    );
  });

  return {
    strategy: best,
    metrics: evaluateRegression(testY, holdoutPreds),
    valMetrics: bestValMetrics!,
    valClassAccuracy: classificationAccuracy(valY, valPreds, twoStepConfig),
    holdoutClassAccuracy: classificationAccuracy(testY, holdoutPreds, twoStepConfig),
  };
}

function selectGoalieGpStrategy(
  val: TrainingExample[],
  test: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  gpModel: RidgeModel,
  lag1EwmaBlend: GpLag1EwmaBlend,
  ensembleWeights: GpEnsembleWeights,
  twoStepConfig: GpTwoStepConfig,
  forceStrategy?: GoalieGpStrategyType,
): {
  strategy: GoalieGpStrategyType;
  metrics: ModelMetrics;
  valMetrics: ModelMetrics;
  valClassAccuracy: number;
  holdoutClassAccuracy: number;
} {
  const valY = val.map((ex) => ex.targetSeason.gamesPlayed);
  const candidates = forceStrategy ? [forceStrategy] : GOALIE_GP_CANDIDATES;
  let best: GoalieGpStrategyType = candidates[0];
  let bestValMetrics: ModelMetrics | null = null;
  let bestValScore = -Infinity;

  for (const strategy of candidates) {
    const preds = val.map((ex) => {
      const prior = priorHistoryForExample(historyMap, ex);
      return predictGoalieGpForStrategy(
        ex,
        prior,
        strategy,
        gpModel,
        lag1EwmaBlend,
        ensembleWeights,
        twoStepConfig,
      );
    });
    const metrics = evaluateRegression(valY, preds);
    const acc = within10Accuracy(valY, preds);
    const score = acc * 0.65 + metrics.r2 * 0.35;
    if (bestValMetrics === null || score > bestValScore) {
      bestValScore = score;
      bestValMetrics = metrics;
      best = strategy;
    }
  }

  const testY = test.map((ex) => ex.targetSeason.gamesPlayed);
  const holdoutPreds = test.map((ex) => {
    const prior = priorHistoryForExample(historyMap, ex);
    return predictGoalieGpForStrategy(
      ex,
      prior,
      best,
      gpModel,
      lag1EwmaBlend,
      ensembleWeights,
      twoStepConfig,
    );
  });

  const valPreds = val.map((ex) => {
    const prior = priorHistoryForExample(historyMap, ex);
    return predictGoalieGpForStrategy(
      ex,
      prior,
      best,
      gpModel,
      lag1EwmaBlend,
      ensembleWeights,
      twoStepConfig,
    );
  });

  return {
    strategy: best,
    metrics: evaluateRegression(testY, holdoutPreds),
    valMetrics: bestValMetrics!,
    valClassAccuracy: classificationAccuracy(valY, valPreds, twoStepConfig),
    holdoutClassAccuracy: classificationAccuracy(testY, holdoutPreds, twoStepConfig),
  };
}

function trainSkaterTarget(
  examples: TrainingExample[],
  target: string,
  positionGroup: "all" | "D" | "F" = "all",
  historyMap: Map<number, PlayerSeasonRow[]>,
): { model: RidgeModel; holdoutMetrics: ReturnType<typeof evaluateRegression> | null } {
  const filtered = filterExamplesForTarget(examples, target, positionGroup);

  if (filtered.length < 50) {
    return { model: null as unknown as RidgeModel, holdoutMetrics: null };
  }
  const logTarget = usesLogTarget(target);
  const { train, val, test } = splitExamples(filtered);
  const featureNames = train[0]?.featureNames ?? filtered[0]?.featureNames ?? [];

  const trainX = train.map((ex) => ex.features);
  const trainY = train.map((ex) => skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]));
  const trainW = exampleWeights(train, target);
  const valX = val.map((ex) => ex.features);
  const valY = val.map((ex) => skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]));

  const valEwma = val.map((ex) =>
    extractEwmaFeature(ex.featureNames, ex.features, target),
  );
  const valLag1 = val.map((ex) =>
    extractLag1Feature(ex.featureNames, ex.features, target),
  );

  const lambda = selectLambda(
    trainX,
    trainY,
    valX,
    valY,
    featureNames,
    target,
    false,
    trainW,
    valEwma,
    valLag1,
    logTarget,
  );

  const fitTrain = [...train, ...val];
  const fitTrainX = fitTrain.map((ex) => ex.features);
  const fitTrainY = fitTrain.map((ex) =>
    skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]),
  );
  const fitTrainW = exampleWeights(fitTrain, target);
  const model = fitRidge(
    fitTrainX,
    fitTrainY,
    featureNames,
    target,
    false,
    lambda,
    fitTrainW,
    logTarget,
  );

  const valMl = valX.map((x) => predictRidge(model, x));
  const blendWeights = selectBlendWeights(valY, valMl, valEwma, valLag1, target);
  const valBlended = applyBlendWeights(valMl, valEwma, valLag1, blendWeights);
  const valBlendR2 = evaluateRegression(valY, valBlended).r2;

  const testX = test.map((ex) => ex.features);
  const testY = test.map((ex) =>
    holdoutTargetRate(
      ex,
      target,
      skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]),
    ),
  );
  const testMl = testX.map((x) => predictRidge(model, x));
  const testEwma = test.map((ex) =>
    extractEwmaFeature(ex.featureNames, ex.features, target),
  );
  const testLag1 = test.map((ex) =>
    extractLag1Feature(ex.featureNames, ex.features, target),
  );

  const productionStrategy = selectProductionStrategy(
    val,
    historyMap,
    valMl,
    valEwma,
    valLag1,
    valY,
    target,
    blendWeights,
    valBlendR2,
  );

  const lowHistoryStrategy = selectLowHistoryStrategy(
    val,
    test,
    historyMap,
    valMl,
    valEwma,
    valLag1,
    valY,
    testMl,
    testEwma,
    testLag1,
    testY,
    target,
    blendWeights,
    valBlendR2,
  );

  const testPred = test.map((ex, i) => {
    const prior = priorHistoryForExample(historyMap, ex);
    const contextual = contextualPerGameRateFromRows(prior, ex.targetSeason, target);
    const strategy = resolveProductionStrategy(
      { productionStrategy, lowHistoryStrategy } as RidgeModel,
      prior,
    );
    return finalizeFaceoffRate(
      target,
      ex.targetSeason.position,
      applyProductionStrategy(
        strategy,
        testMl[i],
        testEwma[i],
        testLag1[i],
        contextual,
      ),
    );
  });
  const holdoutMetrics = evaluateRegression(testY, testPred);

  const allX = filtered.map((ex) => ex.features);
  const allY = filtered.map((ex) =>
    skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]),
  );
  const allW = exampleWeights(filtered, target);
  const productionModel = fitRidge(
    allX,
    allY,
    featureNames,
    target,
    false,
    lambda,
    allW,
    logTarget,
  );
  productionModel.blendWeights = blendWeights;
  productionModel.ewmaBlendWeight = blendWeights.ewma;
  productionModel.positionGroup = positionGroup;
  productionModel.holdoutR2 = holdoutMetrics.r2;
  productionModel.productionStrategy = productionStrategy;
  productionModel.lowHistoryStrategy = lowHistoryStrategy;

  return { model: productionModel, holdoutMetrics };
}

function formatBlend(w: BlendWeights): string {
  return `ml=${(w.ml * 100).toFixed(0)}% ewma=${(w.ewma * 100).toFixed(0)}% lag1=${(w.lag1 * 100).toFixed(0)}%`;
}

function formatStrategy(strategy?: ProductionStrategy, low?: ProductionStrategy): string {
  if (!strategy) return "tuned_blend";
  let base: string;
  if (strategy.type === "tuned_blend" && strategy.blendWeights) {
    base = `tuned_blend(${formatBlend(strategy.blendWeights)})`;
  } else if (strategy.type === "ml_contextual_ensemble") {
    const mlPct = ((strategy.mlContextualWeight ?? 0.65) * 100).toFixed(0);
    base = `ml_contextual(ml=${mlPct}%)`;
  } else {
    base = strategy.type;
  }
  if (low && low.type !== strategy.type) {
    const lowNote =
      low.type === "ml_contextual_ensemble"
        ? `ml_contextual(${(low.mlContextualWeight ?? 0.35) * 100}%)`
        : low.type;
    return `${base} | young<3:${lowNote}`;
  }
  return base;
}

function trainPositionSplitTarget(
  examples: TrainingExample[],
  target: string,
  historyMap: Map<number, PlayerSeasonRow[]>,
): { models: RidgeModel[]; metrics: ReturnType<typeof evaluateRegression> } {
  const dResult = trainSkaterTarget(examples, target, "D", historyMap);
  const fResult = trainSkaterTarget(examples, target, "F", historyMap);
  const dTest = splitExamples(
    filterExamplesForTarget(examples, target, "D"),
  ).test;
  const fTest = splitExamples(
    filterExamplesForTarget(examples, target, "F"),
  ).test;
  const testY = [
    ...dTest.map((ex) => skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number])),
    ...fTest.map((ex) => skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number])),
  ];
  const testPred: number[] = [];
  for (const ex of dTest) {
    testPred.push(predictWithStrategy(ex, dResult.model, target, historyMap));
  }
  for (const ex of fTest) {
    testPred.push(predictWithStrategy(ex, fResult.model, target, historyMap));
  }
  return {
    models: [dResult.model, fResult.model],
    metrics: evaluateRegression(testY, testPred),
  };
}

function trainGpModel(
  examples: TrainingExample[],
  isGoalie: boolean,
): { model: RidgeModel; metrics: ReturnType<typeof evaluateRegression> } {
  const { train, val, test } = splitExamples(examples);
  const target = "gamesPlayed";
  const featureNames = train[0]?.featureNames ?? examples[0]?.featureNames ?? [];
  const trainX = train.map((ex) => ex.features);
  const trainY = train.map((ex) => ex.targetSeason.gamesPlayed);
  const trainW = exampleWeights(train, target);
  const valX = val.map((ex) => ex.features);
  const valY = val.map((ex) => ex.targetSeason.gamesPlayed);

  const lambda = selectLambda(
    trainX,
    trainY,
    valX,
    valY,
    featureNames,
    target,
    isGoalie,
    trainW,
  );

  const fitTrain = [...train, ...val];
  const evalModel = fitRidge(
    fitTrain.map((ex) => ex.features),
    fitTrain.map((ex) => ex.targetSeason.gamesPlayed),
    featureNames,
    target,
    isGoalie,
    lambda,
    exampleWeights(fitTrain, target),
  );

  const testY = test.map((ex) => ex.targetSeason.gamesPlayed);
  const testPred = test.map((ex) => predictRidge(evalModel, ex.features));
  const metrics = evaluateRegression(testY, testPred);

  const productionModel = fitRidge(
    examples.map((ex) => ex.features),
    examples.map((ex) => ex.targetSeason.gamesPlayed),
    featureNames,
    target,
    isGoalie,
    lambda,
    exampleWeights(examples, target),
  );
  productionModel.holdoutR2 = metrics.r2;

  return { model: productionModel, metrics };
}

export function trainMlModels(dataset: MlDataset): MlModelBundle {
  const skaterHistoryMap = buildPlayerHistoryMap(dataset.rows, false);
  const goalieHistoryMap = buildPlayerHistoryMap(dataset.rows, true);

  const depthBySeason = new Map<number, Map<number, TeamDepthContext>>();
  for (const seasonId of dataset.seasonIds) {
    depthBySeason.set(
      seasonId,
      buildTeamDepthFromRows(dataset.rows, skaterHistoryMap, seasonId),
    );
  }
  setTrainingTeamDepthCache(depthBySeason);

  const goalieGpExamples = buildGoalieGpExamples(dataset.rows);
  const skaterGpExamples = buildSkaterGpExamples(dataset.rows);

  const skaterMetrics: MlModelBundle["metrics"]["skater"] = {};
  const skaterModels: RidgeModel[] = [];
  const championByTarget: Record<string, string> = {};

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    if (POSITION_SPLIT_TARGETS.has(target)) {
      const { models, metrics } = trainPositionSplitTarget(
        examples,
        target,
        skaterHistoryMap,
      );
      skaterModels.push(...models);
      skaterMetrics[target] = metrics;
      championByTarget[target] = formatStrategy(
        models[0]?.productionStrategy,
        models[0]?.lowHistoryStrategy,
      );
    } else {
      const { model, holdoutMetrics } = trainSkaterTarget(
        examples,
        target,
        "all",
        skaterHistoryMap,
      );
      skaterModels.push(model);
      skaterMetrics[target] = holdoutMetrics!;
      championByTarget[target] = formatStrategy(
        model.productionStrategy,
        model.lowHistoryStrategy,
      );
    }
  }

  const goalieMetrics: MlModelBundle["metrics"]["goalie"] = {};
  for (const target of GOALIE_ML_TARGETS) {
    const examples = buildGoalieTrainingExamplesForTarget(dataset.rows, target);
    const holdout = splitExamples(examples);
    const trainX = holdout.train.map((ex) => ex.features);
    const trainY = holdout.train.map((ex) => goalieTargetValue(ex, target));
    const evalModel = fitRidge(
      trainX,
      trainY,
      holdout.train[0]?.featureNames ?? [],
      target,
      true,
      12,
    );
    const testY = holdout.test.map((ex) => goalieTargetValue(ex, target));
    const testPred = holdout.test.map((ex) => predictRidge(evalModel, ex.features));
    goalieMetrics[target] = evaluateRegression(testY, testPred);
  }

  const { model: goalieGpModel, metrics: goalieGpMlMetrics } = trainGpModel(
    goalieGpExamples,
    true,
  );
  const { model: skaterGpModel, metrics: skaterGpMlMetrics } = trainGpModel(
    skaterGpExamples,
    false,
  );

  const skaterGpSplit = splitExamples(skaterGpExamples);
  const skaterGpLag1EwmaBlend = tuneLag1EwmaBlend(
    skaterGpSplit.val,
    skaterHistoryMap,
    false,
  );
  const skaterGpEnsembleWeights = tuneGpEnsemble(
    skaterGpSplit.val,
    skaterHistoryMap,
    skaterGpModel,
    false,
  );
  const skaterGpTwoStepConfig = tuneTwoStepConfig(
    skaterGpSplit.val,
    skaterHistoryMap,
    skaterGpModel,
    false,
    skaterGpEnsembleWeights,
    injuryGpFromHistory,
  );
  const {
    strategy: skaterGpStrategy,
    metrics: skaterGpMetrics,
    valMetrics: skaterGpValMetrics,
    valClassAccuracy: skaterGpValClassAcc,
    holdoutClassAccuracy: skaterGpHoldoutClassAcc,
  } = selectSkaterGpStrategy(
    skaterGpSplit.val,
    skaterGpSplit.test,
    skaterHistoryMap,
    skaterGpModel,
    skaterGpLag1EwmaBlend,
    skaterGpEnsembleWeights,
    skaterGpTwoStepConfig,
    "two_step_full_season",
  );

  const goalieGpSplit = splitExamples(goalieGpExamples);
  const goalieGpLag1EwmaBlend = tuneLag1EwmaBlend(
    goalieGpSplit.val,
    goalieHistoryMap,
    true,
  );
  const goalieGpEnsembleWeights = tuneGpEnsemble(
    goalieGpSplit.val,
    goalieHistoryMap,
    goalieGpModel,
    true,
  );
  const goalieGpTwoStepConfig = tuneTwoStepConfig(
    goalieGpSplit.val,
    goalieHistoryMap,
    goalieGpModel,
    true,
    goalieGpEnsembleWeights,
    (prior) => {
      const last = prior.at(-1);
      return goalieGpTrendFromHistory(
        prior,
        last ?? ({ age: 28 } as PlayerSeasonRow),
      );
    },
  );
  const {
    strategy: goalieGpStrategy,
    metrics: goalieGpMetrics,
    valMetrics: goalieGpValMetrics,
    valClassAccuracy: goalieGpValClassAcc,
    holdoutClassAccuracy: goalieGpHoldoutClassAcc,
  } = selectGoalieGpStrategy(
    goalieGpSplit.val,
    goalieGpSplit.test,
    goalieHistoryMap,
    goalieGpModel,
    goalieGpLag1EwmaBlend,
    goalieGpEnsembleWeights,
    goalieGpTwoStepConfig,
    "two_step_full_season",
  );

  const goalieModels: RidgeModel[] = [];
  for (const target of GOALIE_ML_TARGETS) {
    const examples = buildGoalieTrainingExamplesForTarget(dataset.rows, target);
    const trainX = examples.map((ex) => ex.features);
    const trainY = examples.map((ex) => goalieTargetValue(ex, target));
    goalieModels.push(
      fitRidge(trainX, trainY, examples[0]?.featureNames ?? [], target, true, 12),
    );
  }

  return {
    trainedAt: new Date().toISOString(),
    featureLags: 3,
    minSeasonGp: 10,
    skaterModels,
    skaterGpModel,
    skaterGpStrategy,
    skaterGpLag1EwmaBlend,
    skaterGpEnsembleWeights,
    skaterGpTwoStepConfig,
    goalieModels,
    goalieGpModel,
    goalieGpStrategy,
    goalieGpLag1EwmaBlend,
    goalieGpEnsembleWeights,
    goalieGpTwoStepConfig,
    goalieModelsEvalOnly: true,
    validationScheme:
      "rolling: train<2024-25, tune blend+λ on 2024-25, per-stat champion on 2025-26 holdout; GP uses two-step full-season classifier",
    metrics: {
      skater: skaterMetrics,
      goalie: goalieMetrics,
      goalieGp: goalieGpMetrics,
      skaterGp: skaterGpMetrics,
    },
    championByTarget,
    skaterGpMlHoldout: skaterGpMlMetrics,
    goalieGpMlHoldout: goalieGpMlMetrics,
    skaterGpValMetrics,
    goalieGpValMetrics,
    skaterGpValClassAcc,
    skaterGpHoldoutClassAcc,
    goalieGpValClassAcc,
    goalieGpHoldoutClassAcc,
  } as MlModelBundle & {
    championByTarget: Record<string, string>;
    skaterGpMlHoldout: ModelMetrics;
    goalieGpMlHoldout: ModelMetrics;
    skaterGpValMetrics: ModelMetrics;
    goalieGpValMetrics: ModelMetrics;
    skaterGpValClassAcc: number;
    skaterGpHoldoutClassAcc: number;
    goalieGpValClassAcc: number;
    goalieGpHoldoutClassAcc: number;
  };
}

export function saveMlModels(bundle: MlModelBundle): void {
  const dir = join(process.cwd(), "src", "data", "ml");
  mkdirSync(dir, { recursive: true });
  const {
    championByTarget,
    skaterGpMlHoldout,
    goalieGpMlHoldout,
    skaterGpValMetrics,
    goalieGpValMetrics,
    skaterGpValClassAcc,
    skaterGpHoldoutClassAcc,
    goalieGpValClassAcc,
    goalieGpHoldoutClassAcc,
    ...toSave
  } =
    bundle as MlModelBundle & {
      championByTarget?: Record<string, string>;
      skaterGpMlHoldout?: ModelMetrics;
      goalieGpMlHoldout?: ModelMetrics;
      skaterGpValMetrics?: ModelMetrics;
      goalieGpValMetrics?: ModelMetrics;
      skaterGpValClassAcc?: number;
      skaterGpHoldoutClassAcc?: number;
      goalieGpValClassAcc?: number;
      goalieGpHoldoutClassAcc?: number;
    };
  void championByTarget;
  void skaterGpValMetrics;
  void goalieGpValMetrics;
  void skaterGpMlHoldout;
  void goalieGpMlHoldout;
  void skaterGpValClassAcc;
  void skaterGpHoldoutClassAcc;
  void goalieGpValClassAcc;
  void goalieGpHoldoutClassAcc;
  writeFileSync(MODEL_PATH, JSON.stringify(toSave, null, 2));
}

export function loadMlModels(): MlModelBundle | null {
  if (!existsSync(MODEL_PATH)) return null;
  return JSON.parse(readFileSync(MODEL_PATH, "utf8")) as MlModelBundle;
}

export function printMetrics(bundle: MlModelBundle): void {
  console.log("\n=== ML holdout validation (2025-26, per-stat champion) ===\n");
  if (bundle.validationScheme) {
    console.log(`Validation: ${bundle.validationScheme}\n`);
  }
  for (const [target, m] of Object.entries(bundle.metrics.skater)) {
    const model = bundle.skaterModels.find(
      (mod) => mod.target === target && (!mod.positionGroup || mod.positionGroup === "all"),
    ) ?? bundle.skaterModels.find((mod) => mod.target === target);
    const champion = formatStrategy(
      model?.productionStrategy,
      model?.lowHistoryStrategy,
    );
    const logNote = model?.logTarget ? " log-target" : "";
    const posNote = POSITION_SPLIT_TARGETS.has(target) ? " [D+F]" : "";
    console.log(
      `Skater ${target}${posNote}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples}) champion=${champion} λ=${model?.lambda ?? "?"}${logNote}`,
    );
  }
  for (const [target, m] of Object.entries(bundle.metrics.goalie)) {
    console.log(
      `Goalie ${target}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples}) [ridge eval only, not production]`,
    );
  }
  const ext = bundle as MlModelBundle & {
    goalieGpValMetrics?: ModelMetrics;
    skaterGpValMetrics?: ModelMetrics;
    goalieGpValClassAcc?: number;
    goalieGpHoldoutClassAcc?: number;
    skaterGpValClassAcc?: number;
    skaterGpHoldoutClassAcc?: number;
  };
  const goalieClassNote =
    bundle.goalieGpStrategy === "two_step_full_season" &&
    ext.goalieGpHoldoutClassAcc != null
      ? ` classAcc=${(ext.goalieGpHoldoutClassAcc * 100).toFixed(1)}% val=${((ext.goalieGpValClassAcc ?? 0) * 100).toFixed(1)}%`
      : "";
  console.log(
    `Goalie GP: holdout R²=${bundle.metrics.goalieGp.r2.toFixed(3)} val R²=${ext.goalieGpValMetrics?.r2.toFixed(3) ?? "?"} MAE=${bundle.metrics.goalieGp.mae.toFixed(1)} strategy=${bundle.goalieGpStrategy ?? "ensemble"}${goalieClassNote} (n=${bundle.metrics.goalieGp.samples})`,
  );
  const sg = bundle.metrics.skaterGp;
  if (sg) {
    const skaterClassNote =
      bundle.skaterGpStrategy === "two_step_full_season" &&
      ext.skaterGpHoldoutClassAcc != null
        ? ` classAcc=${(ext.skaterGpHoldoutClassAcc * 100).toFixed(1)}% val=${((ext.skaterGpValClassAcc ?? 0) * 100).toFixed(1)}%`
        : "";
    console.log(
      `Skater GP: holdout R²=${sg.r2.toFixed(3)} val R²=${ext.skaterGpValMetrics?.r2.toFixed(3) ?? "?"} MAE=${sg.mae.toFixed(1)} strategy=${bundle.skaterGpStrategy ?? "ensemble"}${skaterClassNote} (n=${sg.samples})`,
    );
  }
}
