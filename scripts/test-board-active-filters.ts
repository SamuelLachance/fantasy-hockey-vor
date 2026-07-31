/**
 * Unit checks for active stat-filter counting.
 * Run: npx tsx scripts/test-board-active-filters.ts
 */
import { countActiveStatFilters } from "../src/lib/board-active-filters";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const keys = ["vor", "sigma", "goals"] as const;
assert(countActiveStatFilters({}, keys) === 0, "empty");
assert(
  countActiveStatFilters({ vor: { min: "1", max: "" } }, keys) === 1,
  "min only",
);
assert(
  countActiveStatFilters(
    { vor: { min: "1", max: "2" }, sigma: { min: "", max: "40" } },
    keys,
  ) === 2,
  "two keys",
);
assert(
  countActiveStatFilters(
    { hits: { min: "10", max: "" } },
    keys,
  ) === 0,
  "ignores keys not in filter list",
);
assert(
  countActiveStatFilters({ vor: { min: "  ", max: "  " } }, keys) === 0,
  "whitespace-only ignored",
);
assert(
  countActiveStatFilters({ vor: { min: "%", max: "," } }, keys) === 0,
  "punctuation-only ignored after normalize",
);
assert(
  countActiveStatFilters({ vor: { min: "10", max: "5" } }, keys) === 0,
  "inverted range not active",
);

if (failed) process.exit(1);
console.log("OK: board-active-filters");
