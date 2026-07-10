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
  fitStackedMetas,
  metaGpPrediction,
  metaRatePrediction,
  runWalkForward,
  V2_SKATER_TARGETS,
} from "../src/lib/ml/stack";
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
    { stack: Metrics[]; marcel: Metrics[]; ewma: Metrics[]; lag1: Metrics[]; gbdt: Metrics[] }
  > = {};
  for (const t of V2_SKATER_TARGETS) {
    perTarget[t] = { stack: [], marcel: [], ewma: [], lag1: [], gbdt: [] };
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

    for (const target of V2_SKATER_TARGETS) {
      const sig = seasonPred.signals.rates[target];
      const yTrue: number[] = [];
      const gp: number[] = [];
      const stackPred: number[] = [];
      const marcelPred: number[] = [];
      const ewmaPred: number[] = [];
      const lag1Pred: number[] = [];
      const gbdtPred: number[] = [];

      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const young = eligibleHistory(ex.history).length <= 2;
        const isD = ex.targetRow.position === "D";
        yTrue.push(actualRate(ex.actualRow, target));
        gp.push(ex.actualRow.gamesPlayed);
        stackPred.push(metaRatePrediction(rateMetas[target], sig, k, young, isD));
        marcelPred.push(sig.marcel[k]);
        ewmaPred.push(sig.ewma[k]);
        lag1Pred.push(sig.lag1[k]);
        gbdtPred.push(sig.gbdt[k]);
      }

      perTarget[target].stack.push(computeMetrics(yTrue, stackPred, gp));
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
  // Goalies
  console.log("\n=== GOALIES ===");
  const gwf = runGoalieWalkForward(rows, wfSeasons, (msg) => console.log(msg));
  const gPerTarget: Record<
    string,
    { stack: Metrics[]; marcel: Metrics[]; ewma: Metrics[]; lag1: Metrics[]; structural: Metrics[] }
  > = {};
  for (const t of GOALIE_V2_TARGETS) {
    gPerTarget[t] = { stack: [], marcel: [], ewma: [], lag1: [], structural: [] };
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
      const marcelP: number[] = [];
      const ewmaP: number[] = [];
      const lag1P: number[] = [];
      const structP: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const low = goalieEligible(ex.history).length <= 2;
        yTrue.push(goalieActual(ex.actualRow, target));
        gpArr.push(ex.actualRow.gamesPlayed);
        stackP.push(goalieMetaRate(metas, target, sig, k, low));
        marcelP.push(sig.marcel[k]);
        ewmaP.push(sig.ewma[k]);
        lag1P.push(sig.lag1[k]);
        structP.push(sig.structural[k]);
      }
      const m = gPerTarget[target];
      m.stack.push(computeMetrics(yTrue, stackP, gpArr));
      m.marcel.push(computeMetrics(yTrue, marcelP, gpArr));
      m.ewma.push(computeMetrics(yTrue, ewmaP, gpArr));
      m.lag1.push(computeMetrics(yTrue, lag1P, gpArr));
      m.structural.push(computeMetrics(yTrue, structP, gpArr));
      console.log(
        `${target.padEnd(10)} stack ${fmt(m.stack.at(-1)!)} | marcel R²=${m.marcel.at(-1)!.r2.toFixed(3)} | ewma R²=${m.ewma.at(-1)!.r2.toFixed(3)} | lag1 R²=${m.lag1.at(-1)!.r2.toFixed(3)} | struct R²=${m.structural.at(-1)!.r2.toFixed(3)}`,
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

  console.log(`\n=== GOALIE AVERAGE over ${testSeasons.length} seasons ===`);
  for (const target of GOALIE_V2_TARGETS) {
    const m = gPerTarget[target];
    console.log(
      `${target.padEnd(10)} stack ${avg(m.stack, "r2").toFixed(3)}/${avg(m.stack, "spearman").toFixed(3)}   marcel ${avg(m.marcel, "r2").toFixed(3)}   ewma ${avg(m.ewma, "r2").toFixed(3)}   lag1 ${avg(m.lag1, "r2").toFixed(3)}   struct ${avg(m.structural, "r2").toFixed(3)}`,
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
