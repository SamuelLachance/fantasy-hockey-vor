import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  printMetrics,
  saveMlModels,
  trainMlModels,
} from "../src/lib/ml/train";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

async function main() {
  if (!existsSync(DATA_PATH)) {
    console.error("ML dataset not found. Run: npm run ml:dataset");
    process.exit(1);
  }

  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  console.log(
    `Training ridge time-series models on ${dataset.rows.length} player-seasons (${dataset.seasonIds[0]}–${dataset.seasonIds.at(-1)})...`,
  );

  const bundle = trainMlModels(dataset);
  saveMlModels(bundle);
  printMetrics(bundle);
  console.log("\nModels saved to src/data/ml/models.json");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
