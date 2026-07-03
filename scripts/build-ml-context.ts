import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { buildContextCaches, saveContextCaches } from "../src/lib/ml/enrich-rows";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("ML dataset not found. Run: npm run ml:dataset -- --force");
    process.exit(1);
  }

  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  console.log(`Refreshing ML context caches for ${dataset.rows.length} player-seasons...`);
  const caches = await buildContextCaches(dataset.rows, console.log);
  saveContextCaches(caches);
  console.log(
    `Saved context cache: ${Object.keys(caches.playerBio).length} bios, ${Object.keys(caches.teamBySeasonTeam).length} team-seasons, ${Object.keys(caches.contractByPlayerSeason).length} contract-seasons`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
