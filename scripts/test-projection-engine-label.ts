/**
 * Unit checks for projection engine display labels.
 * Run: npx tsx scripts/test-projection-engine-label.ts
 */
import {
  DEFAULT_PROJECTION_ENGINE,
  formatProjectionEngine,
} from "../src/lib/projection-engine-label";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  formatProjectionEngine("stacked-ensemble") === "stacked ensemble",
  "hyphens → spaces",
);
assert(formatProjectionEngine("contextual") === "contextual", "plain");
assert(
  formatProjectionEngine("a-b-c") === "a b c",
  "multiple hyphens",
);
assert(
  DEFAULT_PROJECTION_ENGINE === "stacked-ensemble",
  "default engine matches publish gate",
);

if (failed) process.exit(1);
console.log("OK: projection-engine-label");
