/**
 * Holdout metrics segmented by prior NHL seasons (<3 vs 3+).
 * Run: npx tsx scripts/benchmark-young-players.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  buildSkaterTrainingExamplesForTarget,
  extractEwmaFeature,
  extractLag1Feature,
  skaterTargetValue,
  type TrainingExample,
} from "../src/lib/ml/features";
import { applyBlendWeights, evaluateRegression, predictRidge } from "../src/lib/ml/ridge";
import { ML_MIN_SEASON_GP } from "../src/lib/nhl-api";
import type {
  MlDataset,
  PlayerSeasonRow,
  ProductionStrategy,
  RidgeModel,
} from "../src/lib/ml/types";
import { LOW_HISTORY_MAX_PRIOR_SEASONS, SKATER_ML_TARGETS } from "../src/lib/ml/types";
import { loadMlModels } from "../src/lib/ml/train";

const HOLDOUT_SEASON = 20252026;
const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const EWMA_SEASON_WEIGHTS = [0.15, 0.3, 0.55];

function buildPlayerHistoryMap(rows: PlayerSeasonRow[]): Map<number, PlayerSeasonRow[]> {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows.filter((r) => !r.isGoalie)) {
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

function priorNhlSeasons(prior: PlayerSeasonRow[]): number {
  return prior.filter((r) => r.gamesPlayed >= ML_MIN_SEASON_GP).length;
}

function rowStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

function ageCurveMult(position: string, age: number): number {
  if (position === "D") {
    if (age <= 23) return 1.07;
    if (age <= 27) return 1.02;
    if (age >= 34) return 0.92;
    return 1;
  }
  if (age <= 22) return 1.09;
  if (age <= 26) return 1.04;
  if (age >= 33) return 0.91;
  if (age >= 36) return 0.84;
  return 1;
}

function contextualPerGameRateFromRows(
  prior: PlayerSeasonRow[],
  targetSeason: PlayerSeasonRow,
  target: string,
): number {
  const eligible = prior.filter((r) => r.gamesPlayed >= 10);
  if (eligible.length === 0) return 0;
  const recent = eligible.slice(-3);
  const weights = EWMA_SEASON_WEIGHTS.slice(-recent.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let rate = recent.reduce((sum, row, i) => {
    const pgRate = row.gamesPlayed > 0 ? rowStat(row, target) / row.gamesPlayed : 0;
    return sum + pgRate * (weights[i] / totalW);
  }, 0);
  rate *= ageCurveMult(targetSeason.position, targetSeason.age ?? 27);
  if (target === "faceoffWins" && targetSeason.position !== "C") return 0;
  return Math.max(0, rate);
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

function resolveStrategy(model: RidgeModel, prior: PlayerSeasonRow[]): ProductionStrategy {
  if (priorNhlSeasons(prior) <= LOW_HISTORY_MAX_PRIOR_SEASONS) {
    if (model.lowHistoryStrategy) {
      return model.lowHistoryStrategy;
    }
    if (model.productionStrategy?.type === "ml_only" && model.blendWeights) {
      return { type: "tuned_blend", blendWeights: model.blendWeights };
    }
    if (model.productionStrategy?.type === "ml_only") {
      return { type: "ewma_only" };
    }
  }
  return (
    model.productionStrategy ?? {
      type: "tuned_blend" as const,
      blendWeights: model.blendWeights,
    }
  );
}

function predictWithModel(
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
  const strategy = resolveStrategy(model, prior);
  let rate = applyProductionStrategy(strategy, ml, ewma, lag1, contextual);
  if (target === "faceoffWins" && ex.targetSeason.position !== "C") rate = 0;
  return rate;
}

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("Dataset not found");
    process.exit(1);
  }
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const models = loadMlModels();
  if (!models) {
    console.error("Models not found — run npm run ml:train first");
    process.exit(1);
  }

  const historyMap = buildPlayerHistoryMap(dataset.rows);
  console.log("\n=== Young player holdout (2025-26, prior NHL seasons < 3) ===\n");

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    const holdout = examples.filter((e) => e.seasonId === HOLDOUT_SEASON);
    const model =
      models.skaterModels.find(
        (m) => m.target === target && (!m.positionGroup || m.positionGroup === "all"),
      ) ?? models.skaterModels.find((m) => m.target === target);
    if (!model || holdout.length === 0) continue;

    const y = holdout.map((ex) => {
      if (target === "faceoffWins" && ex.targetSeason.position !== "C") return 0;
      return skaterTargetValue(ex, target);
    });
    const preds = holdout.map((ex) => predictWithModel(ex, model, target, historyMap));
    const all = evaluateRegression(y, preds);

    const youngIdx = holdout
      .map((ex, i) => ({ ex, i }))
      .filter(({ ex }) => priorNhlSeasons(priorHistoryForExample(historyMap, ex)) < 3);
    const vetIdx = holdout
      .map((ex, i) => ({ ex, i }))
      .filter(({ ex }) => priorNhlSeasons(priorHistoryForExample(historyMap, ex)) >= 3);

    const youngM =
      youngIdx.length > 0
        ? evaluateRegression(
            youngIdx.map(({ i }) => y[i]),
            youngIdx.map(({ i }) => preds[i]),
          )
        : { r2: 0, mae: 0, samples: 0 };
    const vetM =
      vetIdx.length > 0
        ? evaluateRegression(
            vetIdx.map(({ i }) => y[i]),
            vetIdx.map(({ i }) => preds[i]),
          )
        : { r2: 0, mae: 0, samples: 0 };

    const strat = model.productionStrategy?.type ?? "?";
    const lowStrat = model.lowHistoryStrategy?.type ?? "(same)";
    console.log(
      `${target.padEnd(16)} all R²=${all.r2.toFixed(3)} | young(<3) R²=${youngM.r2.toFixed(3)} n=${youngM.samples} MAE=${youngM.mae.toFixed(3)} | vet(3+) R²=${vetM.r2.toFixed(3)} n=${vetM.samples} | champ=${strat} low=${lowStrat}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
