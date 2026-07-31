/**
 * Unit checks for stat filter panel copy.
 * Run: npx tsx scripts/test-stat-filters-copy.ts
 */
import { statFiltersHintCopy } from "../src/lib/stat-filters-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const hint = statFiltersHintCopy();
assert(hint.includes("Σσ"), "mentions sigma");
assert(hint.includes("91.5%"), "mentions percent form");
assert(hint.includes("0.915"), "mentions decimal form");
assert(hint.includes("91,5"), "mentions comma form");

if (failed) process.exit(1);
console.log("OK: stat-filters-copy");
