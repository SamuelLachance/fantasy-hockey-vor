/**
 * Multi-season rolling-origin backtest for the v2 stacked projection system.
 *
 * For each test season T: base models train on target seasons < T, meta
 * weights fit on pooled out-of-sample predictions from seasons < T, and only
 * then is T scored. Compares against Marcel, EWMA, lag1 and league-mean
 * baselines, and reports the year-over-year reliability ceiling per stat.
 *
 * Usage: npx tsx scripts/backtest.ts [--seasons 20192020,20202021,...]
 */

import { readFileSync } from "fs";
import { join } from "path";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import {
  applyRateCalibrator,
  fitRateCalibrators,
  fitStackedMetas,
  metaGpPrediction,
  metaRatePrediction,
  runWalkForward,
  V2_SKATER_TARGETS,
} from "../src/lib/ml/stack";
import {
  gpSigma,
  popStdev,
  rateUncertainty,
  SIGMA_CALIBRATION,
  UNCERTAINTY_GP_SIGNALS,
  UNCERTAINTY_RATE_SIGNALS,
} from "../src/lib/ml/uncertainty";
import { actualRate, eligibleHistory, gp82 } from "../src/lib/ml/dataset-view";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { DISAGREEMENT_SIGMA, sampleStd } from "../src/lib/ml/market-training";
import {
  fitGoalieMetas,
  goalieActual,
  goalieEligible,
  goalieMetaGp,
  goalieMetaRate,
  GOALIE_V2_TARGETS,
  runGoalieWalkForward,
} from "../src/lib/ml/goalie-v2";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const dataArg = process.argv.find((a) => a.startsWith("--data="));
const DATA_PATH = dataArg
  ? dataArg.split("=")[1]
  : join(process.cwd(), "src", "data", "ml", "dataset.json");

interface Metrics {
  n: number;
  mae: number;
  rmse: number;
  r2: number;
  spearman: number;
  wMae: number;
}

function spearman(yTrue: number[], yPred: number[]): number {
  const n = yTrue.length;
  if (n < 3) return 0;
  const rank = (vals: number[]): number[] => {
    const idx = vals.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && idx[j + 1].v === idx[i].v) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[idx[k].i] = avg;
      i = j + 1;
    }
    return out;
  };
  const ra = rank(yTrue);
  const rb = rank(yPred);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (ra[i] - rb[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

function computeMetrics(yTrue: number[], yPred: number[], gp: number[]): Metrics {
  const n = yTrue.length;
  let mae = 0;
  let mse = 0;
  let wMae = 0;
  let wSum = 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += yTrue[i];
  mean /= Math.max(1, n);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.abs(yPred[i] - yTrue[i]);
    mae += e;
    mse += e * e;
    const w = Math.min(60, gp[i]);
    wMae += w * e;
    wSum += w;
    ssRes += e * e;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return {
    n,
    mae: mae / Math.max(1, n),
    rmse: Math.sqrt(mse / Math.max(1, n)),
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    spearman: spearman(yTrue, yPred),
    wMae: wSum > 0 ? wMae / wSum : 0,
  };
}

function fmt(m: Metrics): string {
  return `R²=${m.r2.toFixed(3)} ρ=${m.spearman.toFixed(3)} MAE=${m.mae.toFixed(4)} wMAE=${m.wMae.toFixed(4)}`;
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  // --no-durability: ablation baseline (features NaN, GP signal falls back).
  const durAttached = process.argv.includes("--no-durability")
    ? 0
    : attachDurability(rows);
  console.log(
    `dataset: ${rows.length} rows, seasons ${dataset.seasonIds[0]}–${dataset.seasonIds.at(-1)}, durability=${durAttached}`,
  );

  const seasonsArg = process.argv.find((a) => a.startsWith("--seasons"));
  const testSeasons = seasonsArg
    ? seasonsArg
        .split("=")[1]
        .split(",")
        .map((s) => Number(s.trim()))
    : [20212022, 20222023, 20232024, 20242025, 20252026];

  // Meta pool needs OOS predictions for seasons before the earliest test
  // season; walk-forward everything from metaStart onward.
  const META_POOL_SEASONS = 5;
  const allSeasonIds = [...new Set(rows.map((r) => r.seasonId))].sort();
  const earliestTest = Math.min(...testSeasons);
  const earliestTestIdx = allSeasonIds.indexOf(earliestTest);
  const startIdx = Math.max(3, earliestTestIdx - META_POOL_SEASONS);
  const wfSeasons = allSeasonIds.slice(startIdx).filter(
    (s) => s <= Math.max(...testSeasons),
  );

  // Team-depth caches used by the contextual baseline and depth features.
  const historyMap = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    const list = historyMap.get(r.playerId) ?? [];
    list.push(r);
    historyMap.set(r.playerId, list);
  }
  for (const list of historyMap.values()) list.sort((a, b) => a.seasonId - b.seasonId);
  const depthBySeason = new Map<number, Map<number, TeamDepthContext>>();
  for (const seasonId of allSeasonIds) {
    depthBySeason.set(seasonId, buildTeamDepthFromRows(rows, historyMap, seasonId));
  }
  setTrainingTeamDepthCache(depthBySeason);

  console.log(`walk-forward over seasons: ${wfSeasons.join(", ")}`);
  const t0 = Date.now();
  const wf = runWalkForward(rows, wfSeasons, (msg) => console.log(msg));
  console.log(`walk-forward done in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // ------------------------------------------------------------------
  // Score each test season with metas fit only on earlier pool seasons.
  const perTarget: Record<
    string,
    {
      stack: Metrics[];
      stackCal: Metrics[];
      marcel: Metrics[];
      ewma: Metrics[];
      lag1: Metrics[];
      gbdt: Metrics[];
    }
  > = {};
  for (const t of V2_SKATER_TARGETS) {
    perTarget[t] = { stack: [], stackCal: [], marcel: [], ewma: [], lag1: [], gbdt: [] };
  }
  const gpMetrics: { stack: Metrics[]; ewma: Metrics[]; lag1: Metrics[]; gbdt: Metrics[] } = {
    stack: [],
    ewma: [],
    lag1: [],
    gbdt: [],
  };
  // Young (≤2 eligible prior seasons) vs veteran GP breakdown.
  const gpYoung: Metrics[] = [];
  const gpVet: Metrics[] = [];

  // ------------------------------------------------------------------
  // Uncertainty calibration (Principle 3): accumulate, per stat, the ratio
  // |residual| / rawσ where rawσ = √(aleatoricFloor² + baseSignalSpread²).
  // The 68th percentile of that ratio is the recommended SIGMA_CALIBRATION so
  // that ±1σ coverage ≈ 0.68. Cross-sectional stat σ and YoY reliability r are
  // measured up front from 40+ GP82 pairs (same population as inference).
  const relR: Record<string, number> = {};
  const relSd: Record<string, number> = {};
  {
    const byPl = new Map<number, PlayerSeasonRow[]>();
    for (const r of rows) {
      if (r.isGoalie) continue;
      const l = byPl.get(r.playerId) ?? [];
      l.push(r);
      byPl.set(r.playerId, l);
    }
    for (const l of byPl.values()) l.sort((a, b) => a.seasonId - b.seasonId);
    for (const target of V2_SKATER_TARGETS) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (const l of byPl.values()) {
        for (let i = 1; i < l.length; i++) {
          if (l[i].seasonId - l[i - 1].seasonId !== 10001) continue;
          if (gp82(l[i - 1]) < 40 || gp82(l[i]) < 40) continue;
          xs.push(actualRate(l[i - 1], target));
          ys.push(actualRate(l[i], target));
        }
      }
      const n = xs.length;
      const mx = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
      const my = ys.reduce((a, b) => a + b, 0) / Math.max(1, n);
      let sxy = 0;
      let sx = 0;
      let sy = 0;
      for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sx += (xs[i] - mx) ** 2;
        sy += (ys[i] - my) ** 2;
      }
      relR[target] = sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0;
      relSd[target] = n > 0 ? Math.sqrt(sy / n) : 0;
    }
  }
  const covRatios: Record<string, number[]> = {};
  for (const t of V2_SKATER_TARGETS) covRatios[t] = [];
  const gpAbsResid: number[] = [];
  let gpDispSum = 0;
  let gpDispN = 0;
  let gpCovHit = 0;
  let gpCovN = 0;

  for (const testSeason of testSeasons) {
    const seasonPred = wf.seasons.find((s) => s.seasonId === testSeason);
    if (!seasonPred) {
      console.warn(`no predictions for ${testSeason}`);
      continue;
    }
    const pool = wf.seasons.filter((s) => s.seasonId < testSeason);
    if (pool.length === 0) {
      console.warn(`no meta pool for ${testSeason}`);
      continue;
    }
    const { rateMetas, gpMeta } = fitStackedMetas(pool, testSeason);
    // Principle 2: fit calibrators on the pool only (never touches testSeason).
    const rateCalibrators = fitRateCalibrators(pool, testSeason);

    for (const target of V2_SKATER_TARGETS) {
      const sig = seasonPred.signals.rates[target];
      const yTrue: number[] = [];
      const gp: number[] = [];
      const stackPred: number[] = [];
      const stackCalPred: number[] = [];
      const marcelPred: number[] = [];
      const ewmaPred: number[] = [];
      const lag1Pred: number[] = [];
      const gbdtPred: number[] = [];

      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const young = eligibleHistory(ex.history).length <= 2;
        const isD = ex.targetRow.position === "D";
        const actual = actualRate(ex.actualRow, target);
        const pred = metaRatePrediction(rateMetas[target], sig, k, young, isD);
        yTrue.push(actual);
        gp.push(ex.actualRow.gamesPlayed);
        stackPred.push(pred);
        stackCalPred.push(applyRateCalibrator(rateCalibrators[target], pred));
        marcelPred.push(sig.marcel[k]);
        ewmaPred.push(sig.ewma[k]);
        lag1Pred.push(sig.lag1[k]);
        gbdtPred.push(sig.gbdt[k]);

        // Uncertainty coverage at the CURRENT calibration constants, so the
        // recommended multiplier converges to 1 once SIGMA_CALIBRATION is set.
        const ru = rateUncertainty(
          target,
          UNCERTAINTY_RATE_SIGNALS.map((s) => (sig as Record<string, Float64Array>)[s]?.[k]),
          relSd[target] ?? 0,
        );
        if (ru.sigma > 0) covRatios[target].push(Math.abs(actual - pred) / ru.sigma);
      }

      perTarget[target].stack.push(computeMetrics(yTrue, stackPred, gp));
      perTarget[target].stackCal.push(computeMetrics(yTrue, stackCalPred, gp));
      perTarget[target].marcel.push(computeMetrics(yTrue, marcelPred, gp));
      perTarget[target].ewma.push(computeMetrics(yTrue, ewmaPred, gp));
      perTarget[target].lag1.push(computeMetrics(yTrue, lag1Pred, gp));
      perTarget[target].gbdt.push(computeMetrics(yTrue, gbdtPred, gp));
    }

    // GP
    {
      const gpSig = seasonPred.signals.gp;
      const yTrue: number[] = [];
      const gpW: number[] = [];
      const stackPred: number[] = [];
      const ewmaPred: number[] = [];
      const lag1Pred: number[] = [];
      const gbdtPred: number[] = [];
      const yYoung: number[] = [];
      const pYoung: number[] = [];
      const yVet: number[] = [];
      const pVet: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const young = eligibleHistory(ex.history).length <= 2;
        const yT = Math.min(82, gp82(ex.actualRow));
        const p = metaGpPrediction(gpMeta, gpSig, k, young);
        yTrue.push(yT);
        gpW.push(60);
        stackPred.push(p);
        ewmaPred.push(gpSig.ewma[k]);
        lag1Pred.push(gpSig.lag1[k]);
        gbdtPred.push(gpSig.gbdt[k]);
        // GP uncertainty: coverage at the current gpSigma, plus the pieces to
        // recommend GP_ALEATORIC ≈ √(P68(|resid|)² − meanDisp²).
        const gpVals = UNCERTAINTY_GP_SIGNALS.map(
          (s) => (gpSig as Record<string, Float64Array>)[s]?.[k],
        );
        const gs = gpSigma(gpVals);
        const ar = Math.abs(yT - p);
        gpAbsResid.push(ar);
        if (gs > 0 && ar <= gs) gpCovHit++;
        gpCovN++;
        gpDispSum += popStdev(gpVals);
        gpDispN++;
        if (young) {
          yYoung.push(yT);
          pYoung.push(p);
        } else {
          yVet.push(yT);
          pVet.push(p);
        }
      }
      gpMetrics.stack.push(computeMetrics(yTrue, stackPred, gpW));
      gpMetrics.ewma.push(computeMetrics(yTrue, ewmaPred, gpW));
      gpMetrics.lag1.push(computeMetrics(yTrue, lag1Pred, gpW));
      gpMetrics.gbdt.push(computeMetrics(yTrue, gbdtPred, gpW));
      if (yYoung.length > 0) {
        gpYoung.push(computeMetrics(yYoung, pYoung, yYoung.map(() => 60)));
      }
      if (yVet.length > 0) {
        gpVet.push(computeMetrics(yVet, pVet, yVet.map(() => 60)));
      }
    }

    console.log(`\n=== ${testSeason} (meta pool: ${pool.map((p) => p.seasonId).join(",")}) ===`);
    for (const target of V2_SKATER_TARGETS) {
      const m = perTarget[target];
      console.log(
        `${target.padEnd(16)} stack ${fmt(m.stack.at(-1)!)} | marcel R²=${m.marcel.at(-1)!.r2.toFixed(3)} | ewma R²=${m.ewma.at(-1)!.r2.toFixed(3)} | lag1 R²=${m.lag1.at(-1)!.r2.toFixed(3)} | gbdt R²=${m.gbdt.at(-1)!.r2.toFixed(3)}`,
      );
    }
    console.log(
      `${"gamesPlayed".padEnd(16)} stack ${fmt(gpMetrics.stack.at(-1)!)} | ewma R²=${gpMetrics.ewma.at(-1)!.r2.toFixed(3)} | lag1 R²=${gpMetrics.lag1.at(-1)!.r2.toFixed(3)} | gbdt R²=${gpMetrics.gbdt.at(-1)!.r2.toFixed(3)}`,
    );
  }

  // ------------------------------------------------------------------
  // Averages across seasons
  const avg = (list: Metrics[], key: keyof Metrics): number =>
    list.length > 0 ? list.reduce((s, m) => s + (m[key] as number), 0) / list.length : NaN;

  console.log(`\n=== AVERAGE over ${testSeasons.length} seasons ===`);
  console.log("target            stack R²/ρ/wMAE      marcel R²   ewma R²   lag1 R²   gbdt R²");
  for (const target of V2_SKATER_TARGETS) {
    const m = perTarget[target];
    console.log(
      `${target.padEnd(16)} ${avg(m.stack, "r2").toFixed(3)}/${avg(m.stack, "spearman").toFixed(3)}/${avg(m.stack, "wMae").toFixed(4)}   ${avg(m.marcel, "r2").toFixed(3)}      ${avg(m.ewma, "r2").toFixed(3)}     ${avg(m.lag1, "r2").toFixed(3)}     ${avg(m.gbdt, "r2").toFixed(3)}`,
    );
  }
  console.log(
    `${"gamesPlayed".padEnd(16)} ${avg(gpMetrics.stack, "r2").toFixed(3)}/${avg(gpMetrics.stack, "spearman").toFixed(3)}/${avg(gpMetrics.stack, "mae").toFixed(2)}   —          ${avg(gpMetrics.ewma, "r2").toFixed(3)}     ${avg(gpMetrics.lag1, "r2").toFixed(3)}     ${avg(gpMetrics.gbdt, "r2").toFixed(3)}`,
  );
  console.log(
    `${"  gp (young)".padEnd(16)} ${avg(gpYoung, "r2").toFixed(3)}/${avg(gpYoung, "spearman").toFixed(3)}/${avg(gpYoung, "mae").toFixed(2)}`,
  );
  console.log(
    `${"  gp (vet)".padEnd(16)} ${avg(gpVet, "r2").toFixed(3)}/${avg(gpVet, "spearman").toFixed(3)}/${avg(gpVet, "mae").toFixed(2)}`,
  );

  // ------------------------------------------------------------------
  // Principle 2: effect of the leakage-free affine calibrator (must not drop
  // Spearman — affine slope ≥ 0 cannot reorder — and should trim RMSE/wMAE).
  console.log(`\n=== CALIBRATION effect (Principle 2: raw stack → calibrated) ===`);
  console.log("target            ΔR²      Δspearman  ΔwMAE       ΔRMSE");
  for (const target of V2_SKATER_TARGETS) {
    const m = perTarget[target];
    const dR2 = avg(m.stackCal, "r2") - avg(m.stack, "r2");
    const dSp = avg(m.stackCal, "spearman") - avg(m.stack, "spearman");
    const dW = avg(m.stackCal, "wMae") - avg(m.stack, "wMae");
    const dRmse = avg(m.stackCal, "rmse") - avg(m.stack, "rmse");
    const sign = (x: number, d = 3): string => (x >= 0 ? "+" : "") + x.toFixed(d);
    console.log(
      `${target.padEnd(16)} ${sign(dR2)}   ${sign(dSp)}     ${sign(dW, 4)}    ${sign(dRmse, 4)}`,
    );
  }

  // ------------------------------------------------------------------
  // Principle 3: 1σ coverage + recommended calibration constants.
  const quantile = (xs: number[], q: number): number => {
    if (xs.length === 0) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))));
    return s[i];
  };
  console.log(`\n=== 1σ COVERAGE (Principle 3; target ≈ 0.68) ===`);
  console.log("target            coverage   recommended SIGMA_CALIBRATION   n");
  for (const target of V2_SKATER_TARGETS) {
    const ratios = covRatios[target];
    const cov = ratios.filter((r) => r <= 1).length / Math.max(1, ratios.length);
    // recommended = current constant × the ratio's 68th percentile → converges
    // to the current constant once coverage ≈ 0.68.
    const recommend = (SIGMA_CALIBRATION[target] ?? 1) * quantile(ratios, 0.68);
    console.log(
      `${target.padEnd(16)} ${cov.toFixed(3)}      ${recommend.toFixed(3)}                          ${ratios.length}`,
    );
  }
  {
    const p68 = quantile(gpAbsResid, 0.68);
    const meanDisp = gpDispN > 0 ? gpDispSum / gpDispN : 0;
    const recGpAle = Math.sqrt(Math.max(0, p68 * p68 - meanDisp * meanDisp));
    const covGp = gpCovHit / Math.max(1, gpCovN);
    console.log(
      `${"gamesPlayed".padEnd(16)} ${covGp.toFixed(3)}      recommended GP_ALEATORIC=${recGpAle.toFixed(1)} (P68|resid|=${p68.toFixed(1)}, meanDisp=${meanDisp.toFixed(1)})`,
    );
  }

  // ------------------------------------------------------------------
  // Agreement vs disagreement zones (synthetic market edge)
  if (!process.argv.includes("--no-market-zones")) {
    console.log(
      `\n=== MARKET ZONES (σ=${DISAGREEMENT_SIGMA}, last test season) ===`,
    );
    const lastSeason = Math.max(...testSeasons);
    const seasonPred = wf.seasons.find((s) => s.seasonId === lastSeason);
    if (seasonPred) {
      const pool = wf.seasons.filter((s) => s.seasonId < lastSeason);
      const { rateMetas } = fitStackedMetas(pool, lastSeason);
      for (const target of ["goals", "assists", "shots"] as const) {
        const sig = seasonPred.signals.rates[target];
        if (!sig?.market) {
          console.log(`${target}: no market signal (market training off?)`);
          continue;
        }
        const yTrue: number[] = [];
        const stackPred: number[] = [];
        const edges: number[] = [];
        const gp: number[] = [];
        for (let k = 0; k < seasonPred.examples.length; k++) {
          const ex = seasonPred.examples[k];
          const young = eligibleHistory(ex.history).length <= 2;
          const isD = ex.targetRow.position === "D";
          const pred = metaRatePrediction(rateMetas[target], sig, k, young, isD);
          const mkt = sig.market[k];
          yTrue.push(actualRate(ex.actualRow, target));
          stackPred.push(pred);
          edges.push(Math.abs(pred - mkt));
          gp.push(ex.actualRow.gamesPlayed);
        }
        const sd = sampleStd(yTrue);
        const thresh = DISAGREEMENT_SIGMA * sd;
        const agreeY: number[] = [];
        const agreeP: number[] = [];
        const agreeG: number[] = [];
        const disY: number[] = [];
        const disP: number[] = [];
        const disG: number[] = [];
        for (let i = 0; i < yTrue.length; i++) {
          if (edges[i] < thresh) {
            agreeY.push(yTrue[i]);
            agreeP.push(stackPred[i]);
            agreeG.push(gp[i]);
          } else {
            disY.push(yTrue[i]);
            disP.push(stackPred[i]);
            disG.push(gp[i]);
          }
        }
        const aM = computeMetrics(agreeY, agreeP, agreeG);
        const dM = computeMetrics(disY, disP, disG);
        console.log(
          `${target.padEnd(16)} agree n=${agreeY.length} ${fmt(aM)} | disagree n=${disY.length} ${fmt(dM)}`,
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Goalies
  console.log("\n=== GOALIES ===");
  const gwf = runGoalieWalkForward(rows, wfSeasons, (msg) => console.log(msg));
  const gPerTarget: Record<
    string,
    {
      stack: Metrics[];
      stackCal: Metrics[];
      marcel: Metrics[];
      ewma: Metrics[];
      lag1: Metrics[];
      structural: Metrics[];
    }
  > = {};
  for (const t of GOALIE_V2_TARGETS) {
    gPerTarget[t] = { stack: [], stackCal: [], marcel: [], ewma: [], lag1: [], structural: [] };
  }
  const gGp: { stack: Metrics[]; ewma: Metrics[]; lag1: Metrics[]; share: Metrics[] } = {
    stack: [],
    ewma: [],
    lag1: [],
    share: [],
  };

  for (const testSeason of testSeasons) {
    const seasonPred = gwf.seasons.find((s) => s.seasonId === testSeason);
    if (!seasonPred) continue;
    const pool = gwf.seasons.filter((s) => s.seasonId < testSeason);
    if (pool.length === 0) continue;
    const metas = fitGoalieMetas(pool, testSeason);

    console.log(`\n--- goalies ${testSeason} ---`);
    for (const target of GOALIE_V2_TARGETS) {
      const sig = seasonPred.signals.rates[target];
      const yTrue: number[] = [];
      const gpArr: number[] = [];
      const stackP: number[] = [];
      const stackCalP: number[] = [];
      const marcelP: number[] = [];
      const ewmaP: number[] = [];
      const lag1P: number[] = [];
      const structP: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const low = goalieEligible(ex.history).length <= 2;
        yTrue.push(goalieActual(ex.actualRow, target));
        gpArr.push(ex.actualRow.gamesPlayed);
        stackP.push(goalieMetaRate(metas, target, sig, k, low, false));
        stackCalP.push(goalieMetaRate(metas, target, sig, k, low, true));
        marcelP.push(sig.marcel[k]);
        ewmaP.push(sig.ewma[k]);
        lag1P.push(sig.lag1[k]);
        structP.push(sig.structural[k]);
      }
      const m = gPerTarget[target];
      m.stack.push(computeMetrics(yTrue, stackP, gpArr));
      m.stackCal.push(computeMetrics(yTrue, stackCalP, gpArr));
      m.marcel.push(computeMetrics(yTrue, marcelP, gpArr));
      m.ewma.push(computeMetrics(yTrue, ewmaP, gpArr));
      m.lag1.push(computeMetrics(yTrue, lag1P, gpArr));
      m.structural.push(computeMetrics(yTrue, structP, gpArr));
      console.log(
        `${target.padEnd(10)} stack ${fmt(m.stack.at(-1)!)} → cal ${fmt(m.stackCal.at(-1)!)}`,
      );
    }
    {
      const gpSig = seasonPred.signals.gp;
      const yTrue: number[] = [];
      const wArr: number[] = [];
      const stackP: number[] = [];
      const ewmaP: number[] = [];
      const lag1P: number[] = [];
      const shareP: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const low = goalieEligible(ex.history).length <= 2;
        yTrue.push(Math.min(72, gp82(ex.actualRow)));
        wArr.push(40);
        stackP.push(goalieMetaGp(metas, gpSig, k, low));
        ewmaP.push(gpSig.ewma[k]);
        lag1P.push(gpSig.lag1[k]);
        shareP.push(gpSig.share[k]);
      }
      gGp.stack.push(computeMetrics(yTrue, stackP, wArr));
      gGp.ewma.push(computeMetrics(yTrue, ewmaP, wArr));
      gGp.lag1.push(computeMetrics(yTrue, lag1P, wArr));
      gGp.share.push(computeMetrics(yTrue, shareP, wArr));
      console.log(
        `${"gamesPlayed".padEnd(10)} stack ${fmt(gGp.stack.at(-1)!)} | ewma R²=${gGp.ewma.at(-1)!.r2.toFixed(3)} | lag1 R²=${gGp.lag1.at(-1)!.r2.toFixed(3)} | share R²=${gGp.share.at(-1)!.r2.toFixed(3)}`,
      );
    }
  }

  console.log(`\n=== GOALIE AVERAGE over ${testSeasons.length} seasons (raw stack → calibrated) ===`);
  for (const target of GOALIE_V2_TARGETS) {
    const m = gPerTarget[target];
    console.log(
      `${target.padEnd(10)} R² ${avg(m.stack, "r2").toFixed(3)} → ${avg(m.stackCal, "r2").toFixed(3)}  ρ ${avg(m.stack, "spearman").toFixed(3)} → ${avg(m.stackCal, "spearman").toFixed(3)}  (marcel ${avg(m.marcel, "r2").toFixed(3)}, struct ${avg(m.structural, "r2").toFixed(3)})`,
    );
  }
  console.log(
    `${"gamesPlayed".padEnd(10)} stack ${avg(gGp.stack, "r2").toFixed(3)}/${avg(gGp.stack, "spearman").toFixed(3)}   ewma ${avg(gGp.ewma, "r2").toFixed(3)}   lag1 ${avg(gGp.lag1, "r2").toFixed(3)}   share ${avg(gGp.share, "r2").toFixed(3)}`,
  );

  // ------------------------------------------------------------------
  // Reliability ceiling (YoY correlation on 40+ GP82 pairs)
  console.log("\n=== Year-over-year reliability ceiling (40+ GP pairs) ===");
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    if (r.isGoalie) continue;
    const l = byPlayer.get(r.playerId) ?? [];
    l.push(r);
    byPlayer.set(r.playerId, l);
  }
  for (const l of byPlayer.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  for (const target of V2_SKATER_TARGETS) {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const l of byPlayer.values()) {
      for (let i = 1; i < l.length; i++) {
        if (l[i].seasonId - l[i - 1].seasonId !== 10001) continue;
        if (gp82(l[i - 1]) < 40 || gp82(l[i]) < 40) continue;
        xs.push(actualRate(l[i - 1], target));
        ys.push(actualRate(l[i], target));
      }
    }
    const n = xs.length;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sx += (xs[i] - mx) ** 2;
      sy += (ys[i] - my) ** 2;
    }
    const r = sxy / Math.sqrt(sx * sy);
    console.log(
      `${target.padEnd(16)} yoy r=${r.toFixed(3)} → ceiling R²≈${(r * r).toFixed(3)}`,
    );
  }

  // GP + goalie ceilings and model efficiency (model R² / ceiling R²): the
  // honest grade is how close each layer sits to its achievable ceiling, not
  // its absolute R² (a stat with a 0.09 ceiling can never hit R²=0.9).
  const yoyCeiling = (
    goalie: boolean,
    stat: string,
    minGp: number,
    perGame: boolean,
  ): number => {
    const byPl = new Map<number, PlayerSeasonRow[]>();
    for (const rr of rows) {
      if (rr.isGoalie !== goalie) continue;
      const l = byPl.get(rr.playerId) ?? [];
      l.push(rr);
      byPl.set(rr.playerId, l);
    }
    for (const l of byPl.values()) l.sort((a, b) => a.seasonId - b.seasonId);
    const xs: number[] = [];
    const ys: number[] = [];
    const val = (rr: PlayerSeasonRow): number => {
      if (stat === "gp82") return gp82(rr);
      let v = (rr as unknown as Record<string, number>)[stat] ?? 0;
      if (stat === "savePct") return v > 1 ? v / 100 : v;
      if (perGame) v = rr.gamesPlayed > 0 ? v / rr.gamesPlayed : 0;
      return v;
    };
    for (const l of byPl.values()) {
      for (let i = 1; i < l.length; i++) {
        if (l[i].seasonId - l[i - 1].seasonId !== 10001) continue;
        if (gp82(l[i - 1]) < minGp || gp82(l[i]) < minGp) continue;
        xs.push(val(l[i - 1]));
        ys.push(val(l[i]));
      }
    }
    const n = xs.length;
    if (n < 3) return 0;
    const mx = xs.reduce((a, b) => a + b, 0) / n;
    const my = ys.reduce((a, b) => a + b, 0) / n;
    let sxy = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < n; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      sx += (xs[i] - mx) ** 2;
      sy += (ys[i] - my) ** 2;
    }
    const rr = sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0;
    return rr * rr;
  };

  console.log("\n=== GP & goalie ceilings vs model (efficiency = model/ceiling) ===");
  const effLine = (label: string, model: number, ceil: number): void => {
    const eff = ceil > 1e-6 ? model / ceil : NaN;
    console.log(
      `${label.padEnd(18)} model R²=${model.toFixed(3)}  ceiling R²=${ceil.toFixed(3)}  efficiency=${(eff * 100).toFixed(0)}%`,
    );
  };
  effLine("skater gp", avg(gpMetrics.stack, "r2"), yoyCeiling(false, "gp82", 40, false));
  effLine("goalie gp", avg(gGp.stack, "r2"), yoyCeiling(true, "gp82", 25, false));
  for (const target of GOALIE_V2_TARGETS) {
    effLine(
      `goalie ${target}`,
      avg(gPerTarget[target].stackCal, "r2"),
      yoyCeiling(true, target, 25, target !== "savePct"),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
