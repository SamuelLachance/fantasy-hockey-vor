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
  usesLogTarget,
  type BlendWeights,
} from "./ridge";
import type { MlDataset, MlModelBundle, RidgeModel } from "./types";
import { GOALIE_ML_TARGETS, SKATER_ML_TARGETS } from "./types";

const MODEL_PATH = join(process.cwd(), "src", "data", "ml", "models.json");
const VAL_SEASON = 20242025;
const HOLDOUT_SEASON = 20252026;

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
const CENTER_ONLY_TARGETS = new Set(["faceoffWins"]);

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
  if (CENTER_ONLY_TARGETS.has(target)) {
    filtered = filtered.filter((ex) => ex.targetSeason.position === "C");
  }
  return filtered;
}

function trainSkaterTarget(
  examples: TrainingExample[],
  target: string,
  positionGroup: "all" | "D" | "F" = "all",
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

  const testX = test.map((ex) => ex.features);
  const testY = test.map((ex) =>
    skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]),
  );
  const testMl = testX.map((x) => predictRidge(model, x));
  const testEwma = test.map((ex) =>
    extractEwmaFeature(ex.featureNames, ex.features, target),
  );
  const testLag1 = test.map((ex) =>
    extractLag1Feature(ex.featureNames, ex.features, target),
  );
  const testBlended = applyBlendWeights(testMl, testEwma, testLag1, blendWeights);
  const holdoutMetrics = evaluateRegression(testY, testBlended);

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

  return { model: productionModel, holdoutMetrics };
}

function formatBlend(w: BlendWeights): string {
  return `ml=${(w.ml * 100).toFixed(0)}% ewma=${(w.ewma * 100).toFixed(0)}% lag1=${(w.lag1 * 100).toFixed(0)}%`;
}

function trainPositionSplitTarget(
  examples: TrainingExample[],
  target: string,
): { models: RidgeModel[]; metrics: ReturnType<typeof evaluateRegression> } {
  const dResult = trainSkaterTarget(examples, target, "D");
  const fResult = trainSkaterTarget(examples, target, "F");
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
    const ml = predictRidge(dResult.model, ex.features);
    const ewma = extractEwmaFeature(ex.featureNames, ex.features, target);
    const lag1 = extractLag1Feature(ex.featureNames, ex.features, target);
    const [p] = applyBlendWeights([ml], [ewma], [lag1], dResult.model.blendWeights!);
    testPred.push(p);
  }
  for (const ex of fTest) {
    const ml = predictRidge(fResult.model, ex.features);
    const ewma = extractEwmaFeature(ex.featureNames, ex.features, target);
    const lag1 = extractLag1Feature(ex.featureNames, ex.features, target);
    const [p] = applyBlendWeights([ml], [ewma], [lag1], fResult.model.blendWeights!);
    testPred.push(p);
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
  const goalieGpExamples = buildGoalieGpExamples(dataset.rows);
  const skaterGpExamples = buildSkaterGpExamples(dataset.rows);

  const skaterMetrics: MlModelBundle["metrics"]["skater"] = {};
  const skaterModels: RidgeModel[] = [];

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    if (POSITION_SPLIT_TARGETS.has(target)) {
      const { models, metrics } = trainPositionSplitTarget(examples, target);
      skaterModels.push(...models);
      skaterMetrics[target] = metrics;
    } else {
      const { model, holdoutMetrics } = trainSkaterTarget(examples, target, "all");
      skaterModels.push(model);
      skaterMetrics[target] = holdoutMetrics!;
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

  const { model: goalieGpModel, metrics: goalieGpMetrics } = trainGpModel(
    goalieGpExamples,
    true,
  );
  const { model: skaterGpModel, metrics: skaterGpMetrics } = trainGpModel(
    skaterGpExamples,
    false,
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
    goalieModels,
    goalieGpModel,
    validationScheme:
      "rolling: train<2024-25, tune blend+λ on 2024-25, holdout 2025-26 (not walk-forward CV)",
    metrics: {
      skater: skaterMetrics,
      goalie: goalieMetrics,
      goalieGp: goalieGpMetrics,
      skaterGp: skaterGpMetrics,
    },
  };
}

export function saveMlModels(bundle: MlModelBundle): void {
  const dir = join(process.cwd(), "src", "data", "ml");
  mkdirSync(dir, { recursive: true });
  writeFileSync(MODEL_PATH, JSON.stringify(bundle, null, 2));
}

export function loadMlModels(): MlModelBundle | null {
  if (!existsSync(MODEL_PATH)) return null;
  return JSON.parse(readFileSync(MODEL_PATH, "utf8")) as MlModelBundle;
}

export function printMetrics(bundle: MlModelBundle): void {
  console.log("\n=== ML holdout validation (2025-26, tuned blend) ===\n");
  if (bundle.validationScheme) {
    console.log(`Validation: ${bundle.validationScheme}\n`);
  }
  for (const [target, m] of Object.entries(bundle.metrics.skater)) {
    const model = bundle.skaterModels.find((mod) => mod.target === target);
    const blend =
      model?.blendWeights != null
        ? ` ${formatBlend(model.blendWeights)} λ=${model.lambda}`
        : model?.ewmaBlendWeight != null
          ? ` blend=${(model.ewmaBlendWeight * 100).toFixed(0)}%ewma λ=${model.lambda}`
          : "";
    const logNote = model?.logTarget ? " log-target" : "";
    const posNote =
      model?.positionGroup && model.positionGroup !== "all"
        ? ` [${model.positionGroup}]`
        : POSITION_SPLIT_TARGETS.has(target)
          ? " [D+F]"
          : "";
    console.log(
      `Skater ${target}${posNote}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples})${blend}${logNote}`,
    );
  }
  for (const [target, m] of Object.entries(bundle.metrics.goalie)) {
    console.log(
      `Goalie ${target}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples}) [ridge eval only, not production]`,
    );
  }
  const g = bundle.metrics.goalieGp;
  console.log(
    `Goalie GP: R²=${g.r2.toFixed(3)} MAE=${g.mae.toFixed(1)} RMSE=${g.rmse.toFixed(1)} (n=${g.samples})`,
  );
  const sg = bundle.metrics.skaterGp;
  if (sg) {
    console.log(
      `Skater GP: R²=${sg.r2.toFixed(3)} MAE=${sg.mae.toFixed(1)} RMSE=${sg.rmse.toFixed(1)} (n=${sg.samples})`,
    );
  }
}
