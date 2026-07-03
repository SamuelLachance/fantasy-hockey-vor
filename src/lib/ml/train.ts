import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  buildGoalieGpExamples,
  buildGoalieTrainingExamplesForTarget,
  buildSkaterTrainingExamplesForTarget,
  goalieTargetValue,
  skaterTargetValue,
} from "./features";
import { evaluateRegression, fitRidge, predictRidge } from "./ridge";
import type { MlDataset, MlModelBundle, RidgeModel } from "./types";
import { GOALIE_ML_TARGETS, SKATER_ML_TARGETS } from "./types";

const MODEL_PATH = join(process.cwd(), "src", "data", "ml", "models.json");

function holdoutBySeason<T extends { seasonId: number }>(
  examples: T[],
  holdoutSeasonId: number,
): { train: T[]; test: T[] } {
  return {
    train: examples.filter((e) => e.seasonId < holdoutSeasonId),
    test: examples.filter((e) => e.seasonId === holdoutSeasonId),
  };
}

export function trainMlModels(dataset: MlDataset): MlModelBundle {
  const goalieGpExamples = buildGoalieGpExamples(dataset.rows);

  const holdoutSeason = 20252026;
  const goalieGpHoldout = holdoutBySeason(goalieGpExamples, holdoutSeason);

  const skaterMetrics: MlModelBundle["metrics"]["skater"] = {};
  const goalieMetrics: MlModelBundle["metrics"]["goalie"] = {};

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    const holdout = holdoutBySeason(examples, holdoutSeason);
    const trainX = holdout.train.map((ex) => ex.features);
    const trainY = holdout.train.map((ex) => skaterTargetValue(ex, target));
    const evalModel = fitRidge(
      trainX,
      trainY,
      holdout.train[0]?.featureNames ?? [],
      target,
      false,
    );
    const testY = holdout.test.map((ex) => skaterTargetValue(ex, target));
    const testPred = holdout.test.map((ex) => predictRidge(evalModel, ex.features));
    skaterMetrics[target] = evaluateRegression(testY, testPred);
  }

  for (const target of GOALIE_ML_TARGETS) {
    const examples = buildGoalieTrainingExamplesForTarget(dataset.rows, target);
    const holdout = holdoutBySeason(examples, holdoutSeason);
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

  const goalieGpTrainX = goalieGpHoldout.train.map((ex) => ex.features);
  const goalieGpTrainY = goalieGpHoldout.train.map((ex) => ex.targetSeason.gamesPlayed);
  const goalieGpEvalModel = fitRidge(
    goalieGpTrainX,
    goalieGpTrainY,
    goalieGpHoldout.train[0]?.featureNames ?? [],
    "gamesPlayed",
    true,
    8,
  );
  const goalieGpTestY = goalieGpHoldout.test.map((ex) => ex.targetSeason.gamesPlayed);
  const goalieGpTestPred = goalieGpHoldout.test.map((ex) =>
    predictRidge(goalieGpEvalModel, ex.features),
  );
  const goalieGpMetrics = evaluateRegression(goalieGpTestY, goalieGpTestPred);

  // Production models: train on all seasons including 2025-26
  const skaterModels: RidgeModel[] = [];
  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    const trainX = examples.map((ex) => ex.features);
    const trainY = examples.map((ex) => skaterTargetValue(ex, target));
    skaterModels.push(
      fitRidge(trainX, trainY, examples[0]?.featureNames ?? [], target, false),
    );
  }

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
  console.log("\n=== ML holdout validation (2025-26) ===\n");
  for (const [target, m] of Object.entries(bundle.metrics.skater)) {
    console.log(
      `Skater ${target}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)} RMSE=${m.rmse.toFixed(3)} (n=${m.samples})`,
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
