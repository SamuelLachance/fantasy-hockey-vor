/**
 * Goalie rate prediction: production path vs persistence baselines.
 * Run: npx tsx scripts/benchmark-goalie-rates.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { buildGoalieGpExamples } from "../src/lib/ml/features";
import { evaluateGoalieProductionHoldout } from "../src/lib/ml/goalie-production-eval";
import { buildTeamDepthFromRows, setTrainingTeamDepthCache } from "../src/lib/ml/team-depth";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const HOLDOUT = 20252026;
const DATA = join(process.cwd(), "src", "data", "ml", "dataset.json");

function buildHistoryMap(rows: PlayerSeasonRow[]) {
  const map = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows.filter((x) => x.isGoalie)) {
    const list = map.get(r.playerId) ?? [];
    list.push(r);
    map.set(r.playerId, list);
  }
  for (const h of map.values()) h.sort((a, b) => a.seasonId - b.seasonId);
  return map;
}

const dataset = JSON.parse(readFileSync(DATA, "utf8")) as MlDataset;
const historyMap = buildHistoryMap(dataset.rows);
const depthBySeason = new Map();
for (const sid of dataset.seasonIds) {
  depthBySeason.set(sid, buildTeamDepthFromRows(dataset.rows, historyMap, sid));
}
setTrainingTeamDepthCache(depthBySeason);

for (const HOLDOUT of [20242025, 20252026]) {
  const holdout = buildGoalieGpExamples(dataset.rows).filter(
    (e) => e.seasonId === HOLDOUT,
  );
  const prod = evaluateGoalieProductionHoldout(holdout, historyMap, dataset.rows);
  console.log(`=== Goalie lag1 production holdout ${HOLDOUT} n=${holdout.length} ===\n`);
  for (const [stat, m] of Object.entries(prod)) {
    console.log(`  ${stat}: R²=${m.r2.toFixed(3)} MAE=${m.mae.toFixed(3)}`);
  }
  console.log();
}
