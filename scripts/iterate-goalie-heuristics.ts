/**
 * Sweep goalie heuristics; print OOS averages; pick best by fantasy score.
 * Fantasy score prioritizes GP + season totals (what categories actually score).
 *
 * Usage: npx tsx scripts/iterate-goalie-heuristics.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { gp82 } from "../src/lib/ml/dataset-view";
import {
  fitGoalieMetas,
  goalieActual,
  goalieMetaGp,
  goalieMetaRate,
  GOALIE_V2_TARGETS,
  getGoalieHeuristics,
  isBackupGoalie,
  renormalizeGoalieGamesByTeam,
  resetGoalieHeuristics,
  runGoalieWalkForward,
  setGoalieHeuristics,
  type GoalieHeuristics,
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

function r2(yTrue: number[], yPred: number[]): number {
  const n = yTrue.length;
  const mean = yTrue.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yTrue[i] - mean) ** 2;
    ssRes += (yTrue[i] - yPred[i]) ** 2;
  }
  return ssTot > 0 ? 1 - ssRes / ssTot : 0;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

type Avg = Record<string, { r2: number; rho: number }>;

async function evalHeuristics(label: string): Promise<{ label: string; avg: Avg; score: number }> {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  attachDurability(rows);
  const allSeasonIds = [...new Set(rows.map((r) => r.seasonId))].sort();
  const earliestIdx = allSeasonIds.indexOf(Math.min(...TEST_SEASONS));
  const wfSeasons = allSeasonIds
    .slice(Math.max(3, earliestIdx - 5))
    .filter((s) => s <= Math.max(...TEST_SEASONS));

  const gwf = runGoalieWalkForward(rows, wfSeasons);
  const acc: Record<string, { r2: number[]; rho: number[] }> = {};
  for (const t of [...GOALIE_V2_TARGETS, "gamesPlayed", "winsTot", "savesTot"]) {
    acc[t] = { r2: [], rho: [] };
  }

  for (const testSeason of TEST_SEASONS) {
    const season = gwf.seasons.find((s) => s.seasonId === testSeason);
    if (!season) continue;
    const pool = gwf.seasons.filter((s) => s.seasonId < testSeason);
    const metas = fitGoalieMetas(pool, testSeason);

    const gpPred: number[] = [];
    const gpTrue: number[] = [];
    const teams: string[] = [];
    for (let k = 0; k < season.examples.length; k++) {
      const ex = season.examples[k];
      const low = isBackupGoalie(ex);
      gpTrue.push(Math.min(72, gp82(ex.actualRow)));
      gpPred.push(goalieMetaGp(metas, season.signals.gp, k, low));
      teams.push(ex.targetRow.team);
    }
    const renorm = renormalizeGoalieGamesByTeam(
      gpPred.map((gamesPlayed, i) => ({
        team: teams[i],
        gamesPlayed,
        isGoalie: true as const,
      })),
    );
    for (let i = 0; i < renorm.length; i++) gpPred[i] = renorm[i].gamesPlayed;

    for (const target of GOALIE_V2_TARGETS) {
      const y: number[] = [];
      const p: number[] = [];
      const yTot: number[] = [];
      const pTot: number[] = [];
      const sig = season.signals.rates[target];
      for (let k = 0; k < season.examples.length; k++) {
        const ex = season.examples[k];
        const low = isBackupGoalie(ex);
        const rate = goalieMetaRate(metas, target, sig, k, low, true);
        y.push(goalieActual(ex.actualRow, target));
        p.push(rate);
        if (target !== "savePct") {
          yTot.push(goalieActual(ex.actualRow, target) * gpTrue[k]);
          pTot.push(rate * gpPred[k]);
        }
      }
      acc[target].r2.push(r2(y, p));
      acc[target].rho.push(spearman(y, p));
      if (target === "wins" || target === "saves") {
        acc[`${target}Tot`].r2.push(r2(yTot, pTot));
        acc[`${target}Tot`].rho.push(spearman(yTot, pTot));
      }
    }
    acc.gamesPlayed.r2.push(r2(gpTrue, gpPred));
    acc.gamesPlayed.rho.push(spearman(gpTrue, gpPred));
  }

  const avg: Avg = {};
  for (const t of Object.keys(acc)) {
    avg[t] = { r2: mean(acc[t].r2), rho: mean(acc[t].rho) };
  }
  const score =
    0.4 * avg.gamesPlayed.r2 +
    0.25 * (avg.winsTot?.r2 ?? avg.wins.r2) +
    0.2 * (avg.savesTot?.r2 ?? avg.saves.r2) +
    0.1 * avg.wins.r2 +
    0.05 * Math.max(0, avg.saves.r2);

  console.log(
    `\n[${label}] h=${JSON.stringify(getGoalieHeuristics())}\n` +
      `  GP ${avg.gamesPlayed.r2.toFixed(3)} ρ=${avg.gamesPlayed.rho.toFixed(3)} | ` +
      `W ${avg.wins.r2.toFixed(3)} (tot ${avg.winsTot.r2.toFixed(3)}) | ` +
      `SV ${avg.saves.r2.toFixed(3)} (tot ${avg.savesTot.r2.toFixed(3)}) | ` +
      `SV% ${avg.savePct.r2.toFixed(3)} | SO ${avg.shutouts.r2.toFixed(3)} | score ${score.toFixed(3)}`,
  );
  return { label, avg, score };
}

/** Locked production defaults + a few nearby challengers. */
const CANDIDATES: Array<{ label: string; h: Partial<GoalieHeuristics> }> = [
  { label: "production", h: {} },
  {
    label: "budget-48",
    h: { featureBudget: 48 },
  },
  {
    label: "budget-56",
    h: { featureBudget: 56 },
  },
  {
    label: "share-light",
    h: { shareBlend: 0.1, teamWinsBlend: 0.1 },
  },
];

async function main() {
  let best = {
    label: "",
    score: -Infinity,
    avg: {} as Avg,
    h: {} as GoalieHeuristics,
  };
  for (const c of CANDIDATES) {
    resetGoalieHeuristics();
    setGoalieHeuristics(c.h);
    const result = await evalHeuristics(c.label);
    if (result.score > best.score) {
      best = { ...result, h: getGoalieHeuristics() };
    }
  }
  console.log(`\n=== BEST: ${best.label} score=${best.score.toFixed(3)} ===`);
  console.log(JSON.stringify(best.h, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
