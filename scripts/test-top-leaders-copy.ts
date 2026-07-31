/**
 * Unit checks for top leaders section copy.
 * Run: npx tsx scripts/test-top-leaders-copy.ts
 */
import {
  TOP_LEADERS_COPY,
  topLeadersSectionLabel,
} from "../src/lib/top-leaders-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  topLeadersSectionLabel() === "Top fantasy hockey leaders",
  "section label",
);
assert(TOP_LEADERS_COPY.overallVor.title.includes("VOR"), "overall title");
assert(TOP_LEADERS_COPY.topEdge.description.includes("Consensus"), "edge desc");
assert(TOP_LEADERS_COPY.steadiest.title.includes("Σσ"), "steadiest title");
assert(TOP_LEADERS_COPY.sortBySigma.includes("Σσ"), "sigma sort link");

if (failed) process.exit(1);
console.log("OK: top-leaders-copy");
