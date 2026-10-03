/**
 * Walk-forward pre-season priors of the v2 engine, one record per
 * player-season, for the in-season backtest (scripts/backtest-in-season.ts
 * --priors=<out>).
 *
 * For each test season T (2021-22 → 2025-26 by default): base models train
 * on seasons < T, stacked metas and rate calibrators fit on the out-of-sample
 * signals of seasons < T (as scripts/backtest.ts), then every skater example
 * of T gets the published per-game rate (`r[stat].cal`, the calibrated
 * stack) and games (`gpModel`, 82-game basis). Nothing of T is seen before
 * it is scored.
 *
 * Run: npx tsx scripts/dump-walk-forward-priors.ts [--data=src/data/ml/dataset.json] [--seasons=20212022,...] --out=<file>
 * (about 10 minutes). The dataset is gitignored: `npm run ml:dataset` builds
 * it first (`npm run inseason:backtest` chains it).
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { actualRate, eligibleHistory, gp82 } from "../src/lib/ml/dataset-view";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { applyRateCalibrator, fitRateCalibrators, fitStackedMetas, metaGpPrediction, metaRatePrediction, runWalkForward, V2_SKATER_TARGETS } from "../src/lib/ml/stack";
import { buildTeamDepthFromRows, setTrainingTeamDepthCache, type TeamDepthContext } from "../src/lib/ml/team-depth";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DATA = arg("data") ?? join(process.cwd(), "src", "data", "ml", "dataset.json");
const OUT = arg("out");
if (!OUT) {
  console.error("--out=<file> required");
  process.exit(1);
}
if (!existsSync(DATA)) {
  console.error(`${DATA} missing: npm run ml:dataset first (gitignored, built from the public NHL stats REST)`);
  process.exit(1);
}
const TEST = (arg("seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",").map(Number);

const ds = JSON.parse(readFileSync(DATA, "utf8")) as MlDataset;
const rows = ds.rows;
attachDurability(rows);
const all = [...new Set(rows.map((r) => r.seasonId))].sort();
const start = Math.max(3, all.indexOf(Math.min(...TEST)) - 5);
const wfSeasons = all.slice(start).filter((s) => s <= Math.max(...TEST));
const history = new Map<number, PlayerSeasonRow[]>();
for (const r of rows) {
  const l = history.get(r.playerId) ?? [];
  l.push(r);
  history.set(r.playerId, l);
}
for (const l of history.values()) l.sort((a, b) => a.seasonId - b.seasonId);
const depth = new Map<number, Map<number, TeamDepthContext>>();
for (const s of all) depth.set(s, buildTeamDepthFromRows(rows, history, s));
setTrainingTeamDepthCache(depth);
const t0 = Date.now();
const wf = runWalkForward(rows, wfSeasons, (m) => console.log(m, `${((Date.now() - t0) / 1000).toFixed(0)} s`));
const out: unknown[] = [];
for (const T of TEST) {
  const sp = wf.seasons.find((s) => s.seasonId === T);
  if (!sp) continue;
  const pool = wf.seasons.filter((s) => s.seasonId < T);
  const { rateMetas, gpMeta } = fitStackedMetas(pool, T);
  const cals = fitRateCalibrators(pool, T);
  sp.examples.forEach((ex, k) => {
    const young = eligibleHistory(ex.history).length <= 2;
    const isD = ex.targetRow.position === "D";
    const r: Record<string, { a: number; cal: number; st: number }> = {};
    for (const t of V2_SKATER_TARGETS) {
      const st = metaRatePrediction(rateMetas[t], sp.signals.rates[t], k, young, isD);
      r[t] = { a: actualRate(ex.actualRow, t), st, cal: applyRateCalibrator(cals[t], st) };
    }
    out.push({ T, id: ex.playerId, name: ex.actualRow.name, pos: ex.targetRow.position, age: ex.targetRow.age ?? null, gpAct: ex.actualRow.gamesPlayed, gp82Act: gp82(ex.actualRow), gpModel: metaGpPrediction(gpMeta, sp.signals.gp, k, young), r });
  });
  console.log(`scored ${T}: ${sp.examples.length}`);
}
writeFileAtomic(OUT, JSON.stringify(out));
console.log(`wrote ${out.length} records → ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
