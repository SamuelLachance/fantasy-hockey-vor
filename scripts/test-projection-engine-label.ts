/**
 * Unit checks for projection engine display labels.
 * Run: npx tsx scripts/test-projection-engine-label.ts
 */
import { formatProjectionEngine } from "../src/lib/projection-engine-label";

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

if (failed) process.exit(1);
console.log("OK: projection-engine-label");
