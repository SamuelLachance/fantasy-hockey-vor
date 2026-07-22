/**
 * Goalie-only walk-forward backtest (fast path for engine iteration).
 * Usage: npx tsx scripts/backtest-goalies.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { gp82 } from "../src/lib/ml/dataset-view";
import {
  fitGoalieMetas,
  getGoalieHeuristics,
  goalieActual,
  goalieMetaGp,
  goalieMetaRate,
  GOALIE_V2_TARGETS,
  isBackupGoalie,
  renormalizeGoalieGamesByTeam,
  runGoalieWalkForward,
} from "../src/lib/ml/goalie-v2";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const TEST_SEASONS = [20212022, 20222023, 20232024, 20242025, 20252026];

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

function metrics(yTrue: number[], yPred: number[]): { r2: number; rho: number; mae: number } {
  const n = yTrue.length;
  const mean = yTrue.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let ssTot = 0;
  let ssRes = 0;
  let mae = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yTrue[i] - mean) ** 2;
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    mae += Math.abs(yTrue[i] - yPred[i]);
  }
  return {
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
    rho: spearman(yTrue, yPred),
    mae: mae / Math.max(1, n),
  };
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  attachDurability(rows);

  const allSeasonIds = [...new Set(rows.map((r) => r.seasonId))].sort();
  const earliestIdx = allSeasonIds.indexOf(Math.min(...TEST_SEASONS));
  const wfSeasons = allSeasonIds
    .slice(Math.max(3, earliestIdx - 5))
    .filter((s) => s <= Math.max(...TEST_SEASONS));

  console.log(`goalie heuristics: ${JSON.stringify(getGoalieHeuristics())}`);
  console.log(`goalie-only walk-forward: ${wfSeasons.join(", ")}`);
  const gwf = runGoalieWalkForward(rows, wfSeasons, (m) => console.log(m));

  const acc: Record<string, { r2: number[]; rho: number[]; calR2: number[] }> = {};
  for (const t of [...GOALIE_V2_TARGETS, "gamesPlayed", "winsTot", "savesTot"]) {
    acc[t] = { r2: [], rho: [], calR2: [] };
  }

  for (const testSeason of TEST_SEASONS) {
    const season = gwf.seasons.find((s) => s.seasonId === testSeason);
    if (!season) continue;
    const pool = gwf.seasons.filter((s) => s.seasonId < testSeason);
    const metas = fitGoalieMetas(pool, testSeason);

    const yGp: number[] = [];
    const pGp: number[] = [];
    const teams: string[] = [];
    for (let k = 0; k < season.examples.length; k++) {
      const ex = season.examples[k];
      yGp.push(Math.min(72, gp82(ex.actualRow)));
      pGp.push(goalieMetaGp(metas, season.signals.gp, k, isBackupGoalie(ex)));
      teams.push(ex.targetRow.team);
    }
    const renorm = renormalizeGoalieGamesByTeam(
      pGp.map((gamesPlayed, i) => ({
        team: teams[i],
        gamesPlayed,
        isGoalie: true as const,
      })),
    );
    for (let i = 0; i < renorm.length; i++) pGp[i] = renorm[i].gamesPlayed;

    console.log(`\n--- ${testSeason} ---`);
    for (const target of GOALIE_V2_TARGETS) {
      const y: number[] = [];
      const raw: number[] = [];
      const cal: number[] = [];
      const yTot: number[] = [];
      const pTot: number[] = [];
      const sig = season.signals.rates[target];
      for (let k = 0; k < season.examples.length; k++) {
        const ex = season.examples[k];
        const low = isBackupGoalie(ex);
        const rateRaw = goalieMetaRate(metas, target, sig, k, low, false);
        const rateCal = goalieMetaRate(metas, target, sig, k, low, true);
        y.push(goalieActual(ex.actualRow, target));
        raw.push(rateRaw);
        cal.push(rateCal);
        if (target === "wins" || target === "saves") {
          yTot.push(goalieActual(ex.actualRow, target) * yGp[k]);
          pTot.push(rateCal * pGp[k]);
        }
      }
      const mRaw = metrics(y, raw);
      const mCal = metrics(y, cal);
      acc[target].r2.push(mRaw.r2);
      acc[target].rho.push(mRaw.rho);
      acc[target].calR2.push(mCal.r2);
      console.log(
        `${target.padEnd(10)} raw R²=${mRaw.r2.toFixed(3)} ρ=${mRaw.rho.toFixed(3)} | cal R²=${mCal.r2.toFixed(3)}`,
      );
      if (target === "wins" || target === "saves") {
        const mTot = metrics(yTot, pTot);
        acc[`${target}Tot`].r2.push(mTot.r2);
        acc[`${target}Tot`].rho.push(mTot.rho);
        acc[`${target}Tot`].calR2.push(mTot.r2);
        console.log(
          `${`${target}Tot`.padEnd(10)} season R²=${mTot.r2.toFixed(3)} ρ=${mTot.rho.toFixed(3)}`,
        );
      }
    }

    const mGp = metrics(yGp, pGp);
    acc.gamesPlayed.r2.push(mGp.r2);
    acc.gamesPlayed.rho.push(mGp.rho);
    acc.gamesPlayed.calR2.push(mGp.r2);
    console.log(`gamesPlayed R²=${mGp.r2.toFixed(3)} ρ=${mGp.rho.toFixed(3)}`);
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  console.log(`\n=== GOALIE AVERAGE over ${TEST_SEASONS.length} seasons ===`);
  console.log(
    "PUBLIC CEILING (approx): SV% YoY R²≈0.04 | GSAx r≈0.12 | fantasy edge is GP/wins totals",
  );
  console.log("PRE-FACTOR BASELINE: wins 0.182, saves 0.037, shutouts -0.069, savePct -0.126, GP 0.309");
  for (const t of [...GOALIE_V2_TARGETS, "gamesPlayed", "winsTot", "savesTot"]) {
    console.log(
      `${t.padEnd(10)} raw R²=${avg(acc[t].r2).toFixed(3)}  cal R²=${avg(acc[t].calR2).toFixed(3)}  ρ=${avg(acc[t].rho).toFixed(3)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
