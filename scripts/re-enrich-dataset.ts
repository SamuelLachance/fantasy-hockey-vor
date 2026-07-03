import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  enrichAllRows,
  loadContextCaches,
} from "../src/lib/ml/enrich-rows";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("ML dataset not found. Run: npm run ml:dataset");
    process.exit(1);
  }

  const caches = loadContextCaches();
  if (!caches) {
    console.error("Context cache not found. Run: npm run ml:context");
    process.exit(1);
  }

  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  console.log(`Re-enriching ${dataset.rows.length} player-seasons with updated context...`);
  dataset.rows = enrichAllRows(dataset.rows, caches);
  dataset.builtAt = new Date().toISOString();
  writeFileSync(DATA_PATH, JSON.stringify(dataset));
  console.log("Dataset re-enriched and saved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
