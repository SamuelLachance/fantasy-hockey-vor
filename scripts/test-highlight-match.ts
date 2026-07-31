/**
 * Unit check: highlightMatch returns plain string when no match.
 * Run: npx tsx scripts/test-highlight-match.ts
 */
import { highlightMatch } from "../src/lib/highlight-match";

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

if (failed) process.exit(1);
console.log("OK: highlight-match");
