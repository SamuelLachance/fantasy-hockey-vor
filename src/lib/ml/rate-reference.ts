/**
 * Loader of the healthy-board edge reference the rate calibration targets
 * (src/data/ml/rate-reference.json, written by `npm run rates:reference`).
 * The reference only applies to the bundle it was fitted for: after a
 * retrain it is ignored (zero-edge target) until it is refitted from a
 * healthy board of the new bundle.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { RateReference } from "../rate-calibration";

export const RATE_REFERENCE_PATH = join(process.cwd(), "src", "data", "ml", "rate-reference.json");
const BUNDLE_PATH = join(process.cwd(), "src", "data", "ml", "v2-bundle.json");

/** `trainedAt` of the committed v2 bundle, or null when it is missing. */
export function currentBundleTrainedAt(): string | null {
  if (!existsSync(BUNDLE_PATH)) return null;
  // The stamp is the bundle's first key; avoid parsing ~1.5MB for it.
  const head = readFileSync(BUNDLE_PATH, "utf8").slice(0, 400);
  const m = head.match(/"trainedAt"\s*:\s*"([^"]+)"/);
  return m ? m[1] : null;
}

export function loadRateReference(): { reference: RateReference | null; note: string } {
  if (!existsSync(RATE_REFERENCE_PATH)) {
    return { reference: null, note: "no rate reference (zero-edge target)" };
  }
  const reference = JSON.parse(readFileSync(RATE_REFERENCE_PATH, "utf8")) as RateReference;
  const trainedAt = currentBundleTrainedAt();
  if (trainedAt && reference.bundleTrainedAt !== trainedAt) {
    return {
      reference: null,
      note: `rate reference fitted for bundle ${reference.bundleTrainedAt}, running ${trainedAt}: ignored (zero-edge target) — refit it with npm run rates:reference from a healthy board of this bundle`,
    };
  }
  return { reference, note: `rate reference: ${reference.source}` };
}
