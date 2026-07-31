/**
 * Unit checks for stat filter panel copy.
 * Run: npx tsx scripts/test-stat-filters-copy.ts
 */
import {
  clearAllStatFiltersCopy,
  doneStatFiltersCopy,
  statFiltersHintCopy,
  statFiltersPanelTitle,
  statsFilterButtonLabel,
} from "../src/lib/stat-filters-copy";

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
assert(statFiltersPanelTitle() === "Filter by stats", "panel title");
assert(clearAllStatFiltersCopy() === "Clear all", "clear all");
assert(doneStatFiltersCopy() === "Done", "done");
assert(statsFilterButtonLabel() === "Stats", "toolbar label");

if (failed) process.exit(1);
console.log("OK: stat-filters-copy");
