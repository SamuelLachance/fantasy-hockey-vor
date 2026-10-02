import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { datasetManifestOf } from "../src/lib/ml/dataset-manifest";
import { buildMlDataset } from "../src/lib/ml/season-collector";
import type { MlDataset } from "../src/lib/ml/types";
import { installNhlHttpDiskCache } from "../src/lib/nhl-http-cache";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const force = process.argv.includes("--force");

/**
 * Rebuild src/data/ml/dataset.json from the public NHL stats REST (serial,
 * ≥ 1.1 s apart, descriptive User-Agent). NHL_HTTP_CACHE=<dir> keeps every
 * response on disk (sha1(url).json) and reuses it on the next rebuild.
 *
 * The dataset is gitignored: after a rebuild, retrain (`npm run ml:train-v2`)
 * so the bundle is stamped with this file's sha1, or `npm run generate`
 * refuses to run (src/lib/ml/dataset-manifest.ts).
 */
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

  const cacheDir = process.env.NHL_HTTP_CACHE;
  const cache = cacheDir ? installNhlHttpDiskCache(cacheDir) : null;
  console.log("Building ML dataset from NHL API (2005-06 through 2025-26)...");
  const dataset = await buildMlDataset((seasonId, i, total) => {
    console.log(`  [${i}/${total}] season ${seasonId}`);
  });

  const raw = JSON.stringify(dataset);
  writeFileAtomic(DATA_PATH, raw);
  const manifest = datasetManifestOf(raw, dataset);
  console.log(
    `Wrote ${dataset.rows.length} player-season rows across ${dataset.seasonIds.length} seasons (sha1 ${manifest.sha1}, built ${manifest.builtAt})${cache ? ` — cache: ${cache.hits()} hits, ${cache.stored()} new` : ""}`,
  );
  console.log("Next: npm run ml:train-v2 (generate only accepts the dataset the bundle was trained on).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
