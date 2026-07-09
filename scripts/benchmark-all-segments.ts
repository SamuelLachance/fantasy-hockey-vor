/**
 * Full holdout benchmark: all stats × segments × position groups.
 * Run: npx tsx scripts/benchmark-all-segments.ts
 * Exits 1 if any cell is below MIN_R2.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  buildGoalieGpExamples,
  buildSkaterTrainingExamplesForTarget,
  extractEwmaFeature,
  extractLag1Feature,
  priorNhlSeasons,
  skaterTargetValue,
  type TrainingExample,
} from "../src/lib/ml/features";
import {
  projectGoalieRatesFromRows,
} from "../src/lib/ml/goalie-production-eval";
import { contextualPerGameRateFromRows, anchorYoungScoringRate } from "../src/lib/ml/contextual-baseline";
import { predictTwoStepGpFromExample } from "../src/lib/ml/gp-two-step";
import { predictStatModel } from "../src/lib/ml/model-predict";
import { applyBlendWeights, evaluateRegression } from "../src/lib/ml/ridge";
import type {
  MlDataset,
  MlModelBundle,
  PlayerSeasonRow,
  ProductionStrategy,
  StatModel,
} from "../src/lib/ml/types";
import {
  GOALIE_ML_TARGETS,
  SKATER_ML_TARGETS,
} from "../src/lib/ml/types";
import { loadMlModels } from "../src/lib/ml/train";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import {
  applyBlocksRoleFilter,
  resolveProductionStrategy,
} from "../src/lib/ml/young-strategy";

const HOLDOUT_SEASON = 20252026;
const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const MIN_R2 = 0.7;

type Segment = "all" | "young" | "veteran";
type PosGroup = "all" | "C" | "LW" | "RW" | "D" | "F" | "G";

interface Cell {
  stat: string;
  segment: Segment;
  position: PosGroup;
  r2: number;
  samples: number;
}

function buildHistoryMap(
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

function priorHistory(
  historyMap: Map<number, PlayerSeasonRow[]>,
  example: TrainingExample,
): PlayerSeasonRow[] {
  const history = historyMap.get(example.playerId) ?? [];
  const idx = history.findIndex((r) => r.seasonId === example.seasonId);
  return idx > 0 ? history.slice(0, idx) : [];
}

function segmentOf(
  prior: PlayerSeasonRow[],
): "young" | "veteran" {
  return priorNhlSeasons(prior) < 3 ? "young" : "veteran";
}

function applyStrategy(
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

function predictSkaterRate(
  ex: TrainingExample,
  model: StatModel,
  target: string,
  historyMap: Map<number, PlayerSeasonRow[]>,
): number {
  const ml = predictStatModel(model, ex.features);
  const ewma = extractEwmaFeature(ex.featureNames, ex.features, target);
  const lag1 = extractLag1Feature(ex.featureNames, ex.features, target);
  const prior = priorHistory(historyMap, ex);
  const contextual = contextualPerGameRateFromRows(prior, ex.targetSeason, target);
  const strategy = resolveProductionStrategy(model, prior);
  let rate = applyStrategy(strategy, ml, ewma, lag1, contextual);
  rate = anchorYoungScoringRate(target, priorNhlSeasons(prior), rate, contextual);
  if (target === "blocks") {
    rate = applyBlocksRoleFilter(rate, ex.targetSeason.position, prior, contextual);
  }
  if (target === "faceoffWins" && ex.targetSeason.position !== "C") rate = 0;
  return rate;
}

function resolveSkaterModel(
  models: StatModel[],
  target: string,
  position: string,
): StatModel | undefined {
  const group = position === "D" ? "D" : "F";
  const candidates = models.filter((m) => m.target === target);
  return (
    candidates.find((m) => m.positionGroup === group) ??
    candidates.find((m) => !m.positionGroup || m.positionGroup === "all")
  );
}

function posGroup(row: PlayerSeasonRow): PosGroup {
  if (row.isGoalie) return "G";
  if (row.position === "C") return "C";
  if (row.position === "LW") return "LW";
  if (row.position === "RW") return "RW";
  return "D";
}

function projectedGoalieGp(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  models: MlModelBundle,
): number {
  const config = models.goalieGpTwoStepConfig;
  if (!config || !models.goalieGpModel) {
    return prior.filter((r) => r.gamesPlayed > 0).at(-1)?.gamesPlayed ?? 40;
  }
  const lastGp = prior.filter((r) => r.gamesPlayed > 0).at(-1)?.gamesPlayed ?? 0;
  const trendGp = lastGp >= 35 ? 58 : Math.max(20, Math.round(lastGp * 0.95));
  return predictTwoStepGpFromExample(
    ex,
    prior,
    models.goalieGpModel,
    config,
    true,
    trendGp,
  );
}

function forwardGroup(row: PlayerSeasonRow): PosGroup {
  return row.position === "D" ? "D" : "F";
}

function segmentFilter(
  ex: TrainingExample,
  historyMap: Map<number, PlayerSeasonRow[]>,
  segment: Segment,
): boolean {
  const prior = priorHistory(historyMap, ex);
  if (segment === "all") return true;
  if (segment === "young") return segmentOf(prior) === "young";
  return segmentOf(prior) === "veteran";
}

function positionFilter(row: PlayerSeasonRow, group: PosGroup): boolean {
  if (group === "all") return true;
  if (group === "G") return row.isGoalie;
  if (group === "F") return !row.isGoalie && row.position !== "D";
  if (group === "D") return row.position === "D";
  return row.position === group;
}

function reportCells(cells: Cell[]): void {
  const fails = cells.filter((c) => c.samples >= 5 && c.r2 < MIN_R2);
  console.log("\n=== Segmented holdout R² (2025-26) ===\n");
  for (const c of cells.sort((a, b) => a.stat.localeCompare(b.stat))) {
    const ok = c.samples < 5 || c.r2 >= MIN_R2 ? " " : "!";
    console.log(
      `${ok} ${c.stat.padEnd(18)} ${c.segment.padEnd(8)} ${c.position.padEnd(4)} R²=${c.r2.toFixed(3)} n=${c.samples}`,
    );
  }
  console.log(`\n${fails.length} cells below ${(MIN_R2 * 100).toFixed(0)}% (n≥5)`);
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

  const skaterHistory = buildHistoryMap(dataset.rows, false);
  const goalieHistory = buildHistoryMap(dataset.rows, true);

  // Mirror training: depth-chart features must be populated in benchmarks too.
  const depthBySeason = new Map<number, Map<number, TeamDepthContext>>();
  for (const seasonId of dataset.seasonIds) {
    depthBySeason.set(
      seasonId,
      buildTeamDepthFromRows(dataset.rows, skaterHistory, seasonId),
    );
  }
  setTrainingTeamDepthCache(depthBySeason);

  const cells: Cell[] = [];

  const skaterSegments: Segment[] = ["all", "young", "veteran"];
  const skaterPositions: PosGroup[] = ["all", "F", "D", "C", "LW", "RW"];

  for (const target of SKATER_ML_TARGETS) {
    const examples = buildSkaterTrainingExamplesForTarget(dataset.rows, target);
    const holdout = examples.filter((e) => e.seasonId === HOLDOUT_SEASON);

    for (const segment of skaterSegments) {
      for (const position of skaterPositions) {
        const subset = holdout.filter(
          (ex) =>
            segmentFilter(ex, skaterHistory, segment) &&
            positionFilter(ex.targetSeason, position),
        );
        if (subset.length === 0) continue;

        const y = subset.map((ex) => {
          if (target === "faceoffWins" && ex.targetSeason.position !== "C") return 0;
          return skaterTargetValue(ex, target);
        });
        const preds = subset.map((ex) => {
          const model = resolveSkaterModel(
            models.skaterModels,
            target,
            ex.targetSeason.position,
          );
          if (!model) return 0;
          return predictSkaterRate(ex, model, target, skaterHistory);
        });
        const m = evaluateRegression(y, preds);
        cells.push({ stat: target, segment, position, r2: m.r2, samples: m.samples });
      }
    }
  }

  const goalieSegments: Segment[] = ["all", "young", "veteran"];
  const goalieGpExamples = buildGoalieGpExamples(dataset.rows).filter(
    (e) => e.seasonId === HOLDOUT_SEASON,
  );
  const twoStepConfig = models.goalieGpTwoStepConfig;

  for (const target of [...GOALIE_ML_TARGETS, "gamesPlayed"] as const) {
    for (const segment of goalieSegments) {
      const subset = goalieGpExamples.filter((ex) => {
        const prior = priorHistory(goalieHistory, ex);
        if (segment === "all") return true;
        if (segment === "young") return segmentOf(prior) === "young";
        return segmentOf(prior) === "veteran";
      });
      if (subset.length === 0) continue;

      if (target === "gamesPlayed") {
        const y = subset.map((ex) => ex.targetSeason.gamesPlayed);
        const preds = subset.map((ex) => {
          const prior = priorHistory(goalieHistory, ex);
          if (!twoStepConfig) return prior.at(-1)?.gamesPlayed ?? 40;
          return projectedGoalieGp(ex, prior, models);
        });
        const m = evaluateRegression(y, preds);
        cells.push({ stat: "goalieGP", segment, position: "G", r2: m.r2, samples: m.samples });
        continue;
      }

      const y = subset.map((ex) => {
        const row = ex.targetSeason;
        const gp = Math.max(1, row.gamesPlayed);
        if (target === "savePct") {
          return row.savePct > 1 ? row.savePct / 100 : row.savePct;
        }
        return (row as unknown as Record<string, number>)[target] / gp;
      });

      const preds = subset.map((ex) => {
        const prior = priorHistory(goalieHistory, ex);
        const projectedGp = projectedGoalieGp(ex, prior, models);
        const rates = projectGoalieRatesFromRows(prior, ex.targetSeason, projectedGp);
        return rates[target];
      });

      const m = evaluateRegression(y, preds);
      cells.push({
        stat: `goalie_${target}`,
        segment,
        position: "G",
        r2: m.r2,
        samples: m.samples,
      });
    }
  }

  reportCells(cells);

  const fails = cells.filter((c) => c.samples >= 5 && c.r2 < MIN_R2);
  if (fails.length > 0) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
