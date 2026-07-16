/**
 * Fit walk-forward base predictions once, then sweep the market-disagreement
 * meta-weight threshold. This isolates the contrarian weighting effect from
 * base-model randomness and avoids retraining GBDT/Ridge for every setting.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { actualRate, eligibleHistory, gp82 } from "../src/lib/ml/dataset-view";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import {
  fitGoalieMetas,
  goalieActual,
  goalieEligible,
  goalieMetaGp,
  goalieMetaRate,
  GOALIE_V2_TARGETS,
  runGoalieWalkForward,
} from "../src/lib/ml/goalie-v2";
import { marketGp, sampleStd } from "../src/lib/ml/market-training";
import {
  fitStackedMetas,
  metaGpPrediction,
  metaRatePrediction,
  runWalkForward,
  V2_SKATER_TARGETS,
} from "../src/lib/ml/stack";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const SIGMAS = [0.4, 0.5, 0.75, 1, 1.5, 2];
const TUNE_SEASONS = [20212022, 20222023, 20232024];
const HOLDOUT_SEASONS = [20242025, 20252026];

interface Series {
  actual: number[];
  pred: number[];
  market: number[];
  weight: number[];
}

interface Summary {
  r2: number;
  nmae: number;
  edgeSigma: number;
  marketCorr: number;
}

function summarize(series: Series): Summary {
  const n = series.actual.length;
  const mean = series.actual.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = sampleStd(series.actual);
  let ssTot = 0;
  let ssRes = 0;
  let weightedAbs = 0;
  let weightSum = 0;
  let edge = 0;
  let predMean = 0;
  let marketMean = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (series.actual[i] - mean) ** 2;
    ssRes += (series.actual[i] - series.pred[i]) ** 2;
    weightedAbs += series.weight[i] * Math.abs(series.actual[i] - series.pred[i]);
    weightSum += series.weight[i];
    edge += Math.abs(series.pred[i] - series.market[i]);
    predMean += series.pred[i];
    marketMean += series.market[i];
  }
  predMean /= Math.max(1, n);
  marketMean /= Math.max(1, n);
  let covariance = 0;
  let predSs = 0;
  let marketSs = 0;
  for (let i = 0; i < n; i++) {
    const pd = series.pred[i] - predMean;
    const md = series.market[i] - marketMean;
    covariance += pd * md;
    predSs += pd * pd;
    marketSs += md * md;
  }
  return {
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    nmae: weightedAbs / Math.max(1e-9, weightSum) / sd,
    edgeSigma: edge / Math.max(1, n) / sd,
    marketCorr: covariance / Math.max(1e-9, Math.sqrt(predSs * marketSs)),
  };
}

function average(summaries: Summary[]): Summary {
  const avg = (key: keyof Summary) =>
    summaries.reduce((sum, row) => sum + row[key], 0) / Math.max(1, summaries.length);
  return {
    r2: avg("r2"),
    nmae: avg("nmae"),
    edgeSigma: avg("edgeSigma"),
    marketCorr: avg("marketCorr"),
  };
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  attachDurability(rows);

  const allSeasonIds = [...new Set(rows.map((r) => r.seasonId))].sort();
  const earliestIdx = allSeasonIds.indexOf(Math.min(...TUNE_SEASONS));
  const wfSeasons = allSeasonIds
    .slice(Math.max(3, earliestIdx - 5))
    .filter((season) => season <= Math.max(...HOLDOUT_SEASONS));

  const historyMap = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    const history = historyMap.get(row.playerId) ?? [];
    history.push(row);
    historyMap.set(row.playerId, history);
  }
  for (const history of historyMap.values()) history.sort((a, b) => a.seasonId - b.seasonId);
  const depthBySeason = new Map<number, Map<number, TeamDepthContext>>();
  for (const season of allSeasonIds) {
    depthBySeason.set(season, buildTeamDepthFromRows(rows, historyMap, season));
  }
  setTrainingTeamDepthCache(depthBySeason);

  console.log(`Training shared walk-forward bases: ${wfSeasons.join(", ")}`);
  const skaterWf = runWalkForward(rows, wfSeasons, (message) => console.log(message));
  const goalieWf = runGoalieWalkForward(rows, wfSeasons, (message) => console.log(message));

  const evaluate = (sigma: number, seasons: number[]): Summary => {
    const summaries: Summary[] = [];
    for (const seasonId of seasons) {
      const season = skaterWf.seasons.find((row) => row.seasonId === seasonId);
      if (!season) continue;
      const pool = skaterWf.seasons.filter((row) => row.seasonId < seasonId);
      const metas = fitStackedMetas(pool, seasonId, sigma);

      for (const target of V2_SKATER_TARGETS) {
        const series: Series = { actual: [], pred: [], market: [], weight: [] };
        const signals = season.signals.rates[target];
        for (let k = 0; k < season.examples.length; k++) {
          const ex = season.examples[k];
          series.actual.push(actualRate(ex.actualRow, target));
          series.pred.push(metaRatePrediction(
            metas.rateMetas[target],
            signals,
            k,
            eligibleHistory(ex.history).length <= 2,
            ex.targetRow.position === "D",
          ));
          series.market.push(signals.market[k]);
          series.weight.push(Math.min(60, ex.actualRow.gamesPlayed));
        }
        summaries.push(summarize(series));
      }

      const gpSeries: Series = { actual: [], pred: [], market: [], weight: [] };
      for (let k = 0; k < season.examples.length; k++) {
        const ex = season.examples[k];
        gpSeries.actual.push(Math.min(82, gp82(ex.actualRow)));
        gpSeries.pred.push(metaGpPrediction(
          metas.gpMeta,
          season.signals.gp,
          k,
          eligibleHistory(ex.history).length <= 2,
        ));
        gpSeries.market.push(marketGp(ex.history));
        gpSeries.weight.push(1);
      }
      summaries.push(summarize(gpSeries));

      const goalieSeason = goalieWf.seasons.find((row) => row.seasonId === seasonId);
      if (!goalieSeason) continue;
      const goaliePool = goalieWf.seasons.filter((row) => row.seasonId < seasonId);
      const goalieMetas = fitGoalieMetas(goaliePool, seasonId, sigma);
      for (const target of GOALIE_V2_TARGETS) {
        const series: Series = { actual: [], pred: [], market: [], weight: [] };
        const signals = goalieSeason.signals.rates[target];
        for (let k = 0; k < goalieSeason.examples.length; k++) {
          const ex = goalieSeason.examples[k];
          const low = goalieEligible(ex.history).length <= 2;
          series.actual.push(goalieActual(ex.actualRow, target));
          series.pred.push(goalieMetaRate(goalieMetas, target, signals, k, low));
          series.market.push(signals.market[k]);
          series.weight.push(Math.min(40, ex.actualRow.gamesPlayed));
        }
        summaries.push(summarize(series));
      }

      const goalieGp: Series = { actual: [], pred: [], market: [], weight: [] };
      for (let k = 0; k < goalieSeason.examples.length; k++) {
        const ex = goalieSeason.examples[k];
        goalieGp.actual.push(Math.min(72, gp82(ex.actualRow)));
        goalieGp.pred.push(goalieMetaGp(
          goalieMetas,
          goalieSeason.signals.gp,
          k,
          goalieEligible(ex.history).length <= 2,
        ));
        goalieGp.market.push(goalieSeason.signals.gp.share[k]);
        goalieGp.weight.push(1);
      }
      summaries.push(summarize(goalieGp));
    }
    return average(summaries);
  };

  console.log("RESULT sigma split r2 nmae edgeSigma marketCorr");
  for (const sigma of SIGMAS) {
    const tune = evaluate(sigma, TUNE_SEASONS);
    const holdout = evaluate(sigma, HOLDOUT_SEASONS);
    for (const [split, summary] of [["tune", tune], ["holdout", holdout]] as const) {
      console.log(
        `RESULT ${sigma} ${split} ${summary.r2.toFixed(6)} ${summary.nmae.toFixed(6)} ` +
        `${summary.edgeSigma.toFixed(6)} ${summary.marketCorr.toFixed(6)}`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
