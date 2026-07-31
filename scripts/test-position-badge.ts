/**
 * Unit checks for position badge a11y helpers.
 * Run: npx tsx scripts/test-position-badge.ts
 */
import {
  positionBadgeAriaLabel,
  positionBadgeTitle,
  uniquePositions,
} from "../src/lib/position-badge";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(positionBadgeTitle("C", false) === "C", "title plain");
assert(
  positionBadgeTitle("C", true) === "VOR calculated at C",
  "title highlight",
);
assert(positionBadgeAriaLabel("D", false) === "Position D", "aria plain");
assert(
  positionBadgeAriaLabel("G", true) === "G, VOR position",
  "aria highlight",
);
assert(
  uniquePositions(["C", "LW", "C"]).join(",") === "C,LW",
  "unique preserves order",
);

if (failed) process.exit(1);
console.log("OK: position-badge");
