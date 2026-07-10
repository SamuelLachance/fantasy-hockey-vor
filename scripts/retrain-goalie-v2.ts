/** Retrain only the goalie half of the v2 bundle (save% fix iteration). */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { PROJECTION_SEASON_ID } from "../src/lib/nhl-api";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
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
import type { MlDataset } from "../src/lib/ml/types";
import type { V2Bundle } from "../src/lib/ml/v2-bundle";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const BUNDLE_PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");
const META_POOL = [
  20192020, 20202021, 20212022, 20222023, 20232024, 20242025, 20252026,
];

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const rows = dataset.rows;
  attachDurability(rows);
  const bundle = JSON.parse(readFileSync(BUNDLE_PATH, "utf8")) as V2Bundle;

  console.log("goalie walk-forward...");
  const gwf = runGoalieWalkForward(rows, META_POOL, (m) => console.log(m));
  const metas = fitGoalieMetas(gwf.seasons, PROJECTION_SEASON_ID);
  console.log(
    "savePct meta:",
    JSON.stringify(metas.rateMetas.savePct.established),
  );

  console.log("training final goalie models...");
  const league = buildGoalieLeagueContext(rows);
  const examples = buildGoalieExamples(rows);
  const registry = loadMoneyPuckRegistrySync();
  const matrix = buildGoalieMatrix(examples, league, registry);
  const levels = buildGoalieLevels(rows);
  const final = trainGoalieBoundary(
    examples,
    matrix,
    league,
    registry,
    PROJECTION_SEASON_ID,
    levels,
  );

  bundle.trainedAt = new Date().toISOString();
  bundle.goalie = {
    gbdt: final.gbdt,
    ridge: final.ridge,
    structural: final.structural,
    gbdtGp: final.gbdtGp,
    ridgeGp: final.ridgeGp,
    metas,
    league: {
      svPct: [...league.svPct.entries()],
      saPerGame: [...league.saPerGame.entries()],
      teamSaPerGame: [...league.teamSaPerGame.entries()],
      teamGoalieGp: [...league.teamGoalieGp.entries()],
    },
  };
  writeFileAtomic(BUNDLE_PATH, JSON.stringify(bundle));
  console.log(`updated goalie section in ${BUNDLE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
