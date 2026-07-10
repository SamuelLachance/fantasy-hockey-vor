/**
 * Train the v2 stacked projection system for production.
 *
 * 1. Walk-forward over recent seasons to generate out-of-sample base
 *    predictions (no leakage).
 * 2. Fit NNLS meta weights on the pooled OOS predictions.
 * 3. Train final base models on ALL completed seasons (boundary =
 *    PROJECTION_SEASON_ID).
 * 4. Save one JSON bundle consumed by predict-v2 at inference.
 *
 * Usage: npx tsx scripts/train-v2.ts
 */

import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { PROJECTION_SEASON_ID } from "../src/lib/nhl-api";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import {
  fitStackedMetas,
  runWalkForward,
  trainBoundary,
  V2_SKATER_TARGETS,
} from "../src/lib/ml/stack";
import {
  buildFeatureMatrix,
  buildLeagueContext,
  buildSkaterExamples,
} from "../src/lib/ml/dataset-view";
import {
  buildGoalieExamples,
  buildGoalieLeagueContext,
  buildGoalieLevels,
  buildGoalieMatrix,
  fitGoalieMetas,
  runGoalieWalkForward,
  trainGoalieBoundary,
} from "../src/lib/ml/goalie-v2";
import { loadMoneyPuckRegistrySync } from "../src/lib/moneypuck-goalies";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";
import type { V2Bundle } from "../src/lib/ml/v2-bundle";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const BUNDLE_PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");

/** Seasons whose OOS predictions feed the meta-learner pool. */
const META_POOL_SEASONS = [
  20192020, 20202021, 20212022, 20222023, 20232024, 20242025, 20252026,
];

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  const durAttached = attachDurability(rows);
  console.log(
    `dataset: ${rows.length} rows, ${dataset.seasonIds.length} seasons, durability=${durAttached}`,
  );

  // Team-depth caches per season (training-time lookups).
  const historyMap = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    const list = historyMap.get(r.playerId) ?? [];
    list.push(r);
    historyMap.set(r.playerId, list);
  }
  for (const list of historyMap.values()) list.sort((a, b) => a.seasonId - b.seasonId);
  const allSeasonIds = [...new Set(rows.map((r) => r.seasonId))].sort();
  const depthBySeason = new Map<number, Map<number, TeamDepthContext>>();
  for (const seasonId of [...allSeasonIds, PROJECTION_SEASON_ID]) {
    depthBySeason.set(seasonId, buildTeamDepthFromRows(rows, historyMap, seasonId));
  }
  setTrainingTeamDepthCache(depthBySeason);

  // ---------------- Skaters ----------------
  console.log("skater walk-forward for meta pool...");
  const wf = runWalkForward(rows, META_POOL_SEASONS, (m) => console.log(m));
  const { rateMetas, gpMeta } = fitStackedMetas(wf.seasons, PROJECTION_SEASON_ID);
  for (const t of V2_SKATER_TARGETS) {
    const w = rateMetas[t].segments.vetF;
    console.log(
      `meta[${t}] vetF: ${w.signals.map((s, i) => `${s}=${w.weights[i].toFixed(3)}`).join(" ")} b=${w.intercept.toFixed(4)}`,
    );
  }

  console.log("training final skater base models on all seasons...");
  const league = buildLeagueContext(rows);
  const examples = buildSkaterExamples(rows);
  const matrix = buildFeatureMatrix(examples, league);
  const finalSkater = trainBoundary(examples, matrix, rows, PROJECTION_SEASON_ID);

  // ---------------- Goalies ----------------
  console.log("goalie walk-forward for meta pool...");
  const gwf = runGoalieWalkForward(rows, META_POOL_SEASONS, (m) => console.log(m));
  const goalieMetas = fitGoalieMetas(gwf.seasons, PROJECTION_SEASON_ID);

  console.log("training final goalie base models on all seasons...");
  const gLeague = buildGoalieLeagueContext(rows);
  const gExamples = buildGoalieExamples(rows);
  const registry = loadMoneyPuckRegistrySync();
  const gMatrix = buildGoalieMatrix(gExamples, gLeague, registry);
  const gLevels = buildGoalieLevels(rows);
  const finalGoalie = trainGoalieBoundary(
    gExamples,
    gMatrix,
    gLeague,
    registry,
    PROJECTION_SEASON_ID,
    gLevels,
  );

  // ---------------- Serialize ----------------
  const bundle: V2Bundle = {
    trainedAt: new Date().toISOString(),
    projectionSeasonId: PROJECTION_SEASON_ID,
    datasetBuiltAt: dataset.builtAt,
    skater: {
      gbdt: finalSkater.gbdt,
      ridge: finalSkater.ridge,
      marcel: finalSkater.marcel,
      gbdtGp: finalSkater.gbdtGp,
      ridgeGp: finalSkater.ridgeGp,
      rateMetas,
      gpMeta,
    },
    goalie: {
      gbdt: finalGoalie.gbdt,
      ridge: finalGoalie.ridge,
      structural: finalGoalie.structural,
      gbdtGp: finalGoalie.gbdtGp,
      ridgeGp: finalGoalie.ridgeGp,
      metas: goalieMetas,
      league: {
        svPct: [...gLeague.svPct.entries()],
        saPerGame: [...gLeague.saPerGame.entries()],
        teamSaPerGame: [...gLeague.teamSaPerGame.entries()],
        teamGoalieGp: [...gLeague.teamGoalieGp.entries()],
      },
    },
  };

  writeFileAtomic(BUNDLE_PATH, JSON.stringify(bundle));
  const sizeMb = (JSON.stringify(bundle).length / 1024 / 1024).toFixed(1);
  console.log(`wrote v2 bundle (${sizeMb} MB) to ${BUNDLE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
