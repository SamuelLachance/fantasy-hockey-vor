/** Goalie-only walk-forward backtest (fast iteration loop). */

import { readFileSync } from "fs";
import { join } from "path";
import { gp82 } from "../src/lib/ml/dataset-view";
import {
  fitGoalieMetas,
  goalieActual,
  goalieEligible,
  goalieMetaGp,
  goalieMetaRate,
  GOALIE_V2_TARGETS,
  runGoalieWalkForward,
} from "../src/lib/ml/goalie-v2";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

function metrics(
  yTrue: number[],
  yPred: number[],
): { r2: number; rho: number; mae: number; bias: number } {
  const n = yTrue.length;
  const mean = yTrue.reduce((a, b) => a + b, 0) / n;
  let ssRes = 0;
  let ssTot = 0;
  let mae = 0;
  let bias = 0;
  for (let i = 0; i < n; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
    mae += Math.abs(yTrue[i] - yPred[i]);
    bias += yPred[i] - yTrue[i];
  }
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
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  return { r2: ssTot > 0 ? 1 - ssRes / ssTot : 0, rho, mae: mae / n, bias: bias / n };
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  attachDurability(rows);
  const testSeasons = [20212022, 20222023, 20232024, 20242025, 20252026];
  const wfSeasons = [
    20162017, 20172018, 20182019, 20192020, 20202021,
    ...testSeasons,
  ];

  const gwf = runGoalieWalkForward(rows, wfSeasons, (m) => console.log(m));

  const agg: Record<string, { stack: number[]; struct: number[]; marcel: number[] }> = {};
  for (const t of [...GOALIE_V2_TARGETS, "gamesPlayed"]) {
    agg[t] = { stack: [], struct: [], marcel: [] };
  }

  for (const testSeason of testSeasons) {
    const seasonPred = gwf.seasons.find((s) => s.seasonId === testSeason);
    if (!seasonPred) continue;
    const pool = gwf.seasons.filter((s) => s.seasonId < testSeason);
    const metas = fitGoalieMetas(pool, testSeason);

    console.log(`\n--- ${testSeason} (n=${seasonPred.examples.length}) ---`);
    for (const target of GOALIE_V2_TARGETS) {
      const sig = seasonPred.signals.rates[target];
      const yTrue: number[] = [];
      const stackP: number[] = [];
      const structP: number[] = [];
      const marcelP: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const low = goalieEligible(ex.history).length <= 2;
        yTrue.push(goalieActual(ex.actualRow, target));
        stackP.push(goalieMetaRate(metas, target, sig, k, low));
        structP.push(sig.structural[k]);
        marcelP.push(sig.marcel[k]);
      }
      const mS = metrics(yTrue, stackP);
      const mT = metrics(yTrue, structP);
      const mM = metrics(yTrue, marcelP);
      agg[target].stack.push(mS.r2);
      agg[target].struct.push(mT.r2);
      agg[target].marcel.push(mM.r2);
      console.log(
        `${target.padEnd(9)} stack R²=${mS.r2.toFixed(3)} ρ=${mS.rho.toFixed(3)} MAE=${mS.mae.toFixed(4)} bias=${mS.bias >= 0 ? "+" : ""}${mS.bias.toFixed(4)} | struct R²=${mT.r2.toFixed(3)} | marcel R²=${mM.r2.toFixed(3)}`,
      );
    }
    {
      const gpSig = seasonPred.signals.gp;
      const yTrue: number[] = [];
      const stackP: number[] = [];
      for (let k = 0; k < seasonPred.examples.length; k++) {
        const ex = seasonPred.examples[k];
        const low = goalieEligible(ex.history).length <= 2;
        yTrue.push(Math.min(72, gp82(ex.actualRow)));
        stackP.push(goalieMetaGp(metas, gpSig, k, low));
      }
      const mS = metrics(yTrue, stackP);
      agg.gamesPlayed.stack.push(mS.r2);
      console.log(`${"gp".padEnd(9)} stack R²=${mS.r2.toFixed(3)} ρ=${mS.rho.toFixed(3)} MAE=${mS.mae.toFixed(2)}`);
    }
  }

  console.log("\n=== averages ===");
  const avg = (l: number[]) => l.reduce((a, b) => a + b, 0) / Math.max(1, l.length);
  for (const t of GOALIE_V2_TARGETS) {
    console.log(
      `${t.padEnd(9)} stack=${avg(agg[t].stack).toFixed(3)} struct=${avg(agg[t].struct).toFixed(3)} marcel=${avg(agg[t].marcel).toFixed(3)}`,
    );
  }
  console.log(`gp        stack=${avg(agg.gamesPlayed.stack).toFixed(3)}`);

  // Year-over-year reliability ceiling: consecutive 25+ GP goalie season pairs.
  console.log("\n=== goalie YoY reliability (25+ GP pairs) ===");
  const byPlayer = new Map<number, typeof rows>();
  for (const r of rows) {
    if (!r.isGoalie || r.gamesPlayed < 25) continue;
    const list = byPlayer.get(r.playerId) ?? [];
    list.push(r);
    byPlayer.set(r.playerId, list);
  }
  for (const t of [...GOALIE_V2_TARGETS, "gamesPlayed"]) {
    const a: number[] = [];
    const b: number[] = [];
    for (const list of byPlayer.values()) {
      list.sort((x, y) => x.seasonId - y.seasonId);
      for (let i = 1; i < list.length; i++) {
        if (list[i].seasonId - list[i - 1].seasonId !== 10001) continue;
        if (t === "gamesPlayed") {
          a.push(gp82(list[i - 1]));
          b.push(gp82(list[i]));
        } else {
          a.push(goalieActual(list[i - 1], t));
          b.push(goalieActual(list[i], t));
        }
      }
    }
    const n = a.length;
    const ma = a.reduce((s, v) => s + v, 0) / n;
    const mb = b.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    const r = num / Math.sqrt(da * db);
    console.log(`${t.padEnd(12)} yoy r=${r.toFixed(3)} → ceiling R²≈${(r * r).toFixed(3)} (n=${n})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
