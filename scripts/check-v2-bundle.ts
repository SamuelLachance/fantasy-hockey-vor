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
  datasetBuiltAt?: string;
  projectionSeasonId?: number;
  marketTraining?: unknown;
  skater?: {
    gbdt?: unknown;
    ridge?: unknown;
    gpMeta?: unknown;
    rateMetas?: unknown;
    gbdtGp?: unknown;
    ridgeGp?: unknown;
  };
  goalie?: {
    gbdt?: unknown;
    ridge?: unknown;
    gbdtGp?: unknown;
    ridgeGp?: unknown;
    metas?: unknown;
  };
};

const errors: string[] = [];
const warnings: string[] = [];

if (!bundle.trainedAt || !Number.isFinite(Date.parse(bundle.trainedAt))) {
  errors.push("trainedAt missing/invalid");
} else {
  const ageDays =
    (Date.now() - Date.parse(bundle.trainedAt)) / (24 * 60 * 60 * 1000);
  if (ageDays > 120) {
    errors.push(
      `v2 bundle trainedAt is ${ageDays.toFixed(0)} days old (fail after 120d)`,
    );
  } else if (ageDays > 60) {
    warnings.push(`v2 bundle trainedAt is ${ageDays.toFixed(0)} days old`);
  }
}

if (!bundle.datasetBuiltAt) {
  errors.push("datasetBuiltAt missing");
} else if (!Number.isFinite(Date.parse(bundle.datasetBuiltAt))) {
  errors.push("datasetBuiltAt is invalid");
}

if (!bundle.projectionSeasonId) errors.push("projectionSeasonId missing");
else if (bundle.projectionSeasonId !== 20262027) {
  errors.push(
    `projectionSeasonId ${bundle.projectionSeasonId} != 20262027 (update check when rolling seasons)`,
  );
}
if (bundle.marketTraining == null) {
  errors.push("marketTraining section missing");
}

if (!bundle.skater?.gbdt || !bundle.skater?.ridge) {
  errors.push("skater gbdt/ridge models missing");
}
if (!bundle.skater?.gbdtGp || !bundle.skater?.ridgeGp) {
  errors.push("skater GP models (gbdtGp/ridgeGp) missing");
}
if (!bundle.skater?.gpMeta) errors.push("skater gpMeta missing");
if (!bundle.skater?.rateMetas) errors.push("skater rateMetas missing");

if (!bundle.goalie) errors.push("goalie section missing");
else {
  if (!bundle.goalie.gbdt || !bundle.goalie.ridge) {
    errors.push("goalie gbdt/ridge models missing");
  }
  if (!bundle.goalie.gbdtGp || !bundle.goalie.ridgeGp) {
    errors.push("goalie GP models (gbdtGp/ridgeGp) missing");
  }
  if (!bundle.goalie.metas) errors.push("goalie metas missing");
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: v2-bundle trained ${bundle.trainedAt}, season ${bundle.projectionSeasonId}`,
);
