/**
 * CI guard: committed v2 bundle is present and structurally sane.
 * Run: npx tsx scripts/check-v2-bundle.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PROJECTION_SEASON_ID } from "../src/lib/nhl-api";
import { NO_AFFINE_CALIBRATION, SHIPPED_META_WEIGHTING } from "../src/lib/ml/stack";
import { loadMarketFile, marketLinesFor, MARKET_BLEND_STATS, zeroFilledMarketStats, type MarketBlend } from "../src/lib/ml/market-blend";

const PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");

if (!existsSync(PATH)) {
  console.error("FAIL: src/data/ml/v2-bundle.json missing");
  process.exit(1);
}

const bundle = JSON.parse(readFileSync(PATH, "utf8")) as {
  trainedAt?: string;
  datasetBuiltAt?: string;
  datasetSha1?: string;
  projectionSeasonId?: number;
  marketTraining?: unknown;
  skater?: {
    gbdt?: unknown;
    ridge?: unknown;
    gpMeta?: unknown;
    rateMetas?: unknown;
    rateCalibrators?: Record<string, unknown>;
    metaWeighting?: { weighting?: string; recencyDecay?: number };
    marketBlend?: MarketBlend;
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
else if (bundle.projectionSeasonId !== PROJECTION_SEASON_ID) {
  errors.push(
    `projectionSeasonId ${bundle.projectionSeasonId} != ${PROJECTION_SEASON_ID}`,
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
const affine = Object.keys(bundle.skater?.rateCalibrators ?? {}).filter((t) => NO_AFFINE_CALIBRATION.includes(t));
if (affine.length > 0) {
  errors.push(`affine rate calibrator shipped on ${affine.join(", ")} (it doubles the stars' under-projection)`);
}
// Skater metas: the weighting the projection backtest validated
// (src/data/ml/projection-scorecard.json, scripts/check-projection-scorecard.ts).
const mw = bundle.skater?.metaWeighting;
if (
  !mw ||
  mw.weighting !== SHIPPED_META_WEIGHTING.weighting ||
  mw.recencyDecay !== SHIPPED_META_WEIGHTING.recencyDecay
) {
  errors.push(
    `skater metaWeighting ${JSON.stringify(mw ?? null)} != shipped ${JSON.stringify(SHIPPED_META_WEIGHTING)} (retrain: npm run ml:train-v2)`,
  );
}
// Market blend: weights in [0, 1], fitted on several seasons, and market
// lines for the projection season to apply them to.
const blend = bundle.skater?.marketBlend;
if (!blend) {
  errors.push("skater marketBlend missing (src/data/ml/market-espn.json, then npm run ml:train-v2)");
} else {
  const bad = [...MARKET_BLEND_STATS.map((t) => blend.betas?.[t]), blend.gpBeta].filter(
    (b) => !(typeof b === "number" && b >= 0 && b <= 1),
  );
  if (bad.length > 0) errors.push(`marketBlend weight outside [0, 1]: ${bad.join(", ")}`);
  if ((blend.fittedSeasons?.length ?? 0) < 4 || blend.pairs < 1000) {
    errors.push(`marketBlend fitted on ${blend.fittedSeasons?.length ?? 0} seasons / ${blend.pairs} player-seasons (< 4 / 1000)`);
  }
  // A stat the market did not publish must be null (skipped), never 0 for
  // everyone: zero-filled hits / blocks once pulled their weights to 0.
  for (const z of zeroFilledMarketStats(loadMarketFile())) {
    errors.push(
      `market-espn.json ${z.seasonId}: ${z.stat} is 0 for every projected skater (unpublished stat stored as 0, not null: npm run market:espn)`,
    );
  }
  const lines = marketLinesFor(loadMarketFile(), bundle.projectionSeasonId ?? PROJECTION_SEASON_ID);
  if (lines.size < 200) {
    errors.push(
      `market projections for ${bundle.projectionSeasonId}: ${lines.size} skaters (< 200): refresh src/data/ml/market-espn.json (npm run market:espn)`,
    );
  }
}

if (!bundle.datasetSha1) {
  errors.push("datasetSha1 missing (retrain with npm run ml:train-v2: generate needs the training dataset's identity)");
}

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
