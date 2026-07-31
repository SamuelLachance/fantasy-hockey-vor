/**
 * Unit check: highlightMatch returns plain string when no match.
 * Run: npx tsx scripts/test-highlight-match.ts
 */
import { HIGHLIGHT_QUERY_MAX, highlightMatch } from "../src/lib/highlight-match";

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

if (failed) process.exit(1);
console.log("OK: highlight-match");
