import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildGoalieGpExamples,
  buildGoalieTrainingExamplesForTarget,
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
  type BlendWeights,
} from "./ridge";
import type { MlDataset, MlModelBundle, RidgeModel } from "./types";
import { GOALIE_ML_TARGETS, SKATER_ML_TARGETS } from "./types";

const MODEL_PATH = join(process.cwd(), "src", "data", "ml", "models.json");
const VAL_SEASON = 20242025;
const HOLDOUT_SEASON = 20252026;

function splitExamples<T extends { seasonId: number }>(
  examples: T[],
): { train: T[]; val: T[]; test: T[] } {
  return {
    train: examples.filter((e) => e.seasonId < VAL_SEASON),
    val: examples.filter((e) => e.seasonId === VAL_SEASON),
    test: examples.filter((e) => e.seasonId === HOLDOUT_SEASON),
  };
}

function recencyWeight(seasonId: number): number {
  const startYear = Math.floor(seasonId / 10000);
  const age = 2025 - startYear;
  return Math.exp(-0.2 * age);
}

function exampleWeights(examples: TrainingExample[]): number[] {
  return examples.map((ex) => recencyWeight(ex.seasonId));
}

const POSITION_SPLIT_TARGETS = new Set(["blocks", "hits"]);

function rowPositionGroup(row: { position?: string }): "D" | "F" {
  return row.position === "D" ? "D" : "F";
}

function trainSkaterTarget(
  examples: TrainingExample[],
  target: string,
  positionGroup: "all" | "D" | "F" = "all",
): { model: RidgeModel; holdoutMetrics: ReturnType<typeof evaluateRegression> | null } {
  const filtered =
    positionGroup === "all"
      ? examples
      : examples.filter((ex) => rowPositionGroup(ex.targetSeason) === positionGroup);

  if (filtered.length < 50) {
    return { model: null as unknown as RidgeModel, holdoutMetrics: null };
  }
  const { train, val, test } = splitExamples(filtered);
  const featureNames = train[0]?.featureNames ?? filtered[0]?.featureNames ?? [];

  const trainX = train.map((ex) => ex.features);
  const trainY = train.map((ex) => skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]));
  const trainW = exampleWeights(train);
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
  );

  const fitTrain = [...train, ...val];
  const fitTrainX = fitTrain.map((ex) => ex.features);
  const fitTrainY = fitTrain.map((ex) =>
    skaterTargetValue(ex, target as (typeof SKATER_ML_TARGETS)[number]),
  );
  const fitTrainW = exampleWeights(fitTrain);
  const model = fitRidge(
    fitTrainX,
    fitTrainY,
    featureNames,
    target,
    false,
    lambda,
    fitTrainW,
  );

  const valMl = valX.map((x) => predictRidge(model, x));
  const blendWeights = selectBlendWeights(valY, valMl, valEwma, valLag1);

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
  const allW = exampleWeights(filtered);
  const productionModel = fitRidge(
    allX,
    allY,
    featureNames,
    target,
    false,
    lambda,
    allW,
  );
  productionModel.blendWeights = blendWeights;
  productionModel.ewmaBlendWeight = blendWeights.ewma;
  productionModel.positionGroup = positionGroup;

  return { model: productionModel, holdoutMetrics };
}

function formatBlend(w: BlendWeights): string {
  return `ml=${(w.ml * 100).toFixed(0)}% ewma=${(w.ewma * 100).toFixed(0)}% lag1=${(w.lag1 * 100).toFixed(0)}%`;
}

export function trainMlModels(dataset: MlDataset): MlModelBundle {
  const goalieGpExamples = buildGoalieGpExamples(dataset.rows);
  const { train: gpTrain, test: gpTest } = {
    train: goalieGpExamples.filter((e) => e.seasonId < HOLDOUT_SEASON),
    test: goalieGpExamples.filter((e) => e.seasonId === HOLDOUT_SEASON),
  };

  const skaterMetrics: MlModelBundle["metrics"]["skater"] = {};
  const skaterModels: RidgeModel[] = [];

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    if (POSITION_SPLIT_TARGETS.has(target)) {
      const dResult = trainSkaterTarget(examples, target, "D");
      const fResult = trainSkaterTarget(examples, target, "F");
      skaterModels.push(dResult.model, fResult.model);
      const dTest = splitExamples(examples.filter((e) => rowPositionGroup(e.targetSeason) === "D")).test;
      const fTest = splitExamples(examples.filter((e) => rowPositionGroup(e.targetSeason) === "F")).test;
      const testY = [
        ...dTest.map((ex) => skaterTargetValue(ex, target)),
        ...fTest.map((ex) => skaterTargetValue(ex, target)),
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
      skaterMetrics[target] = evaluateRegression(testY, testPred);
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

  const goalieGpTrainX = gpTrain.map((ex) => ex.features);
  const goalieGpTrainY = gpTrain.map((ex) => ex.targetSeason.gamesPlayed);
  const goalieGpEvalModel = fitRidge(
    goalieGpTrainX,
    goalieGpTrainY,
    gpTrain[0]?.featureNames ?? [],
    "gamesPlayed",
    true,
    8,
  );
  const goalieGpTestY = gpTest.map((ex) => ex.targetSeason.gamesPlayed);
  const goalieGpTestPred = gpTest.map((ex) => predictRidge(goalieGpEvalModel, ex.features));
  const goalieGpMetrics = evaluateRegression(goalieGpTestY, goalieGpTestPred);

  const goalieModels: RidgeModel[] = [];
  for (const target of GOALIE_ML_TARGETS) {
    const examples = buildGoalieTrainingExamplesForTarget(dataset.rows, target);
    const trainX = examples.map((ex) => ex.features);
    const trainY = examples.map((ex) => goalieTargetValue(ex, target));
    goalieModels.push(
      fitRidge(trainX, trainY, examples[0]?.featureNames ?? [], target, true, 12),
    );
  }

  const goalieGpModel = fitRidge(
    goalieGpExamples.map((ex) => ex.features),
    goalieGpExamples.map((ex) => ex.targetSeason.gamesPlayed),
    goalieGpExamples[0]?.featureNames ?? [],
    "gamesPlayed",
    true,
    8,
  );

  return {
    trainedAt: new Date().toISOString(),
    featureLags: 3,
    minSeasonGp: 10,
    skaterModels,
    goalieModels,
    goalieGpModel,
    metrics: {
      skater: skaterMetrics,
      goalie: goalieMetrics,
      goalieGp: goalieGpMetrics,
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
  for (const [target, m] of Object.entries(bundle.metrics.skater)) {
    const model = bundle.skaterModels.find((mod) => mod.target === target);
    const blend =
      model?.blendWeights != null
        ? ` ${formatBlend(model.blendWeights)} λ=${model.lambda}`
        : model?.ewmaBlendWeight != null
          ? ` blend=${(model.ewmaBlendWeight * 100).toFixed(0)}%ewma λ=${model.lambda}`
          : "";
    console.log(
      `Skater ${target}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples})${blend}`,
    );
  }
  for (const [target, m] of Object.entries(bundle.metrics.goalie)) {
    console.log(
      `Goalie ${target}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples})`,
    );
  }
  const g = bundle.metrics.goalieGp;
  console.log(
    `Goalie GP: R²=${g.r2.toFixed(3)} MAE=${g.mae.toFixed(1)} RMSE=${g.rmse.toFixed(1)} (n=${g.samples})`,
  );
}
