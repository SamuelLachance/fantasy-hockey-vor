import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildMlDataset } from "../src/lib/ml/season-collector";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const force = process.argv.includes("--force");

async function main() {
  if (!force && existsSync(DATA_PATH)) {
    const cached = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
    const age = Date.now() - new Date(cached.builtAt).getTime();
    if (age < MAX_AGE_MS && cached.rows.length > 0) {
      console.log(
        `Using cached ML dataset (${cached.rows.length} player-seasons, ${cached.seasonIds.length} seasons)`,
      );
      return;
    }
  }

  console.log("Building ML dataset from NHL API (2005-06 through 2025-26)...");
  const dataset = await buildMlDataset((seasonId, i, total) => {
    console.log(`  [${i}/${total}] season ${seasonId}`);
  });

  writeFileAtomic(DATA_PATH, JSON.stringify(dataset));
  console.log(
    `Wrote ${dataset.rows.length} player-season rows across ${dataset.seasonIds.length} seasons`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
