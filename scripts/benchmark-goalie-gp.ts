/**
 * Compare goalie GP strategies on 2025-26 holdout.
 * Run: npx tsx scripts/benchmark-goalie-gp.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { buildGoalieGpExamples } from "../src/lib/ml/features";
import { clearGoalieAllocationCache } from "../src/lib/ml/goalie-team-allocator";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
} from "../src/lib/ml/team-depth";
import { spearmanCorrelation } from "../src/lib/ml/metrics";
import { evaluateRegression } from "../src/lib/ml/ridge";
import { loadMlModels } from "../src/lib/ml/train";
import type { GoalieGpStrategyType, MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const HOLDOUT = 20252026;
const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

// Re-implement minimal strategy predictors (train.ts helpers are private)
import { predictStatModel } from "../src/lib/ml/model-predict";
import {
  extractEwmaGp,
  extractLag1Gp,
} from "../src/lib/ml/gp-predict";
import { predictTwoStepGpFromExample } from "../src/lib/ml/gp-two-step";
import { goalieGpFromTeamAllocation } from "../src/lib/ml/goalie-team-allocator";

function buildHistoryMap(rows: PlayerSeasonRow[]): Map<number, PlayerSeasonRow[]> {
  const map = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows.filter((x) => x.isGoalie)) {
    const list = map.get(r.playerId) ?? [];
    list.push(r);
    map.set(r.playerId, list);
  }
  for (const h of map.values()) h.sort((a, b) => a.seasonId - b.seasonId);
  return map;
}

function priorHistory(
  map: Map<number, PlayerSeasonRow[]>,
  playerId: number,
  seasonId: number,
): PlayerSeasonRow[] {
  const h = map.get(playerId) ?? [];
  const i = h.findIndex((r) => r.seasonId === seasonId);
  return i > 0 ? h.slice(0, i) : [];
}

function goalieGpTrend(prior: PlayerSeasonRow[], target: PlayerSeasonRow): number {
  const lastGp = prior.filter((r) => r.gamesPlayed > 0).at(-1)?.gamesPlayed ?? 0;
  const age = target.age ?? 28;
  let gp = lastGp;
  if (age >= 37) gp *= 0.82;
  else if (age >= 34) gp *= 0.9;
  else if (age <= 25) gp *= 1.03;
  return Math.max(10, Math.min(82, Math.round(gp * 0.95)));
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const models = loadMlModels();
  if (!models) throw new Error("No models");

  const historyMap = buildHistoryMap(dataset.rows);
  const depthBySeason = new Map();
  for (const sid of dataset.seasonIds) {
    depthBySeason.set(sid, buildTeamDepthFromRows(dataset.rows, historyMap, sid));
  }
  setTrainingTeamDepthCache(depthBySeason);

  const holdout = buildGoalieGpExamples(dataset.rows).filter(
    (e) => e.seasonId === HOLDOUT,
  );
  const y = holdout.map((e) => e.targetSeason.gamesPlayed);

  const strategies: GoalieGpStrategyType[] = [
    "lag1_only",
    "ewma_only",
    "lag1_ewma_blend",
    "trend_based",
    "ensemble",
    "two_step_full_season",
    "team_allocation",
    "ml_only",
    "fixed_role",
  ];

  const cfg = models.goalieGpTwoStepConfig!;
  const blend = models.goalieGpLag1EwmaBlend!;
  const ens = models.goalieGpEnsembleWeights!;

  console.log(`Goalie GP holdout n=${holdout.length}\n`);
  console.log("strategy          R²      MAE   Spearman  within10");

  for (const strategy of strategies) {
    clearGoalieAllocationCache();
    const preds = holdout.map((ex) => {
      const prior = priorHistory(historyMap, ex.playerId, ex.seasonId);
      const lag1 = extractLag1Gp(ex.featureNames, ex.features);
      const ewma = extractEwmaGp(ex.featureNames, ex.features);
      const ml = predictStatModel(models.goalieGpModel, ex.features);
      const trend = goalieGpTrend(prior, ex.targetSeason);

      switch (strategy) {
        case "lag1_only":
          return Math.max(10, Math.min(82, Math.round(lag1)));
        case "ewma_only":
          return Math.max(10, Math.min(82, Math.round(ewma)));
        case "lag1_ewma_blend":
          return Math.max(
            10,
            Math.min(82, Math.round(lag1 * blend.lag1 + ewma * blend.ewma)),
          );
        case "trend_based":
          return trend;
        case "ml_only":
          return Math.max(10, Math.min(82, Math.round(ml)));
        case "fixed_role":
          return (prior.at(-1)?.gamesPlayed ?? 0) >= 35 ? 60 : 22;
        case "ensemble":
          return Math.max(
            10,
            Math.min(
              82,
              Math.round(
                lag1 * ens.lag1 +
                  ewma * ens.ewma +
                  ml * ens.ml +
                  trend * ens.injury,
              ),
            ),
          );
        case "two_step_full_season":
          return predictTwoStepGpFromExample(
            ex,
            prior,
            models.goalieGpModel,
            cfg,
            true,
            trend,
          );
        case "team_allocation":
          return goalieGpFromTeamAllocation(
            ex,
            prior,
            dataset.rows,
            historyMap,
            depthBySeason.get(ex.seasonId) ?? new Map(),
          );
        default:
          return trend;
      }
    });

    const m = evaluateRegression(y, preds);
    const spear = spearmanCorrelation(y, preds);
    let w10 = 0;
    for (let i = 0; i < y.length; i++) {
      if (Math.abs(y[i] - preds[i]) <= 10) w10++;
    }
    console.log(
      `${strategy.padEnd(18)} ${m.r2.toFixed(3).padStart(6)}  ${m.mae.toFixed(1).padStart(5)}  ${spear.toFixed(3).padStart(8)}  ${((w10 / y.length) * 100).toFixed(0)}%`,
    );
  }

  // Oracle: use lag1 only
  const lag1preds = holdout.map((ex) =>
    Math.max(10, Math.min(82, Math.round(extractLag1Gp(ex.featureNames, ex.features)))),
  );
  const lag1m = evaluateRegression(y, lag1preds);
  console.log(`\nLag1 persistence alone: R²=${lag1m.r2.toFixed(3)} MAE=${lag1m.mae.toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
