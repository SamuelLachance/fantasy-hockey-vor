/**
 * CI guard: committed v2 bundle is present and structurally sane.
 * Run: npx tsx scripts/check-v2-bundle.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");

if (!existsSync(PATH)) {
  console.error("FAIL: src/data/ml/v2-bundle.json missing");
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(PATH, "utf8")) as {
  trainedAt?: string;
  projectionSeasonId?: number;
  skater?: { gbdt?: unknown; ridge?: unknown; gpMeta?: unknown };
  goalie?: unknown;
};

const errors: string[] = [];
if (!bundle.trainedAt || !Number.isFinite(Date.parse(bundle.trainedAt))) {
  errors.push("trainedAt missing/invalid");
}
if (!bundle.projectionSeasonId) errors.push("projectionSeasonId missing");
if (!bundle.skater?.gbdt || !bundle.skater?.ridge) {
  errors.push("skater gbdt/ridge models missing");
}
if (!bundle.goalie) errors.push("goalie section missing");

if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: v2-bundle trained ${bundle.trainedAt}, season ${bundle.projectionSeasonId}`,
);
