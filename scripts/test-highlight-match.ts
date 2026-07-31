/**
 * Unit check: highlightMatch returns plain string when no match.
 * Run: npx tsx scripts/test-highlight-match.ts
 */
import {
  HIGHLIGHT_QUERY_MAX,
  clearSearchAriaLabel,
  highlightMatch,
  searchFieldAriaLabel,
  searchFieldPlaceholder,
  searchQueryIsClearable,
  searchQueryLengthLabel,
  searchQueryNearCap,
} from "../src/lib/highlight-match";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(highlightMatch("McDavid", "") === "McDavid", "empty query");
assert(highlightMatch("McDavid", "xyz") === "McDavid", "no match");
const hit = highlightMatch("Connor McDavid", "mcd");
assert(typeof hit === "object" && hit != null, "match returns element tree");
const multi = highlightMatch("Anaheim Ducks fan", "a");
assert(typeof multi === "object" && multi != null, "multi-match tree");
assert(
  highlightMatch("McDavid", "x".repeat(80)) === "McDavid" ||
    typeof highlightMatch("McDavid", "x".repeat(80)) === "object",
  "long query capped without throw",
);
assert(HIGHLIGHT_QUERY_MAX === 48, "shared max length");
assert(searchQueryNearCap(39) === false, "below near-cap");
assert(searchQueryNearCap(40) === true, "at near-cap threshold");
assert(searchQueryNearCap(48) === true, "at max");
assert(searchQueryLengthLabel(12) === "12/48", "length label");
assert(searchFieldAriaLabel().includes("players"), "search aria");
assert(searchFieldPlaceholder().endsWith("..."), "placeholder");
assert(clearSearchAriaLabel() === "Clear search", "clear aria");
assert(searchQueryIsClearable("") === false, "empty not clearable");
assert(searchQueryIsClearable("   ") === true, "whitespace clearable");
assert(searchQueryIsClearable("a") === true, "text clearable");

if (failed) process.exit(1);
console.log("OK: highlight-match");
