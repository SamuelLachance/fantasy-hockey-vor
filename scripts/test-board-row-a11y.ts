/**
 * Unit checks for board row accessible names.
 * Run: npx tsx scripts/test-board-row-a11y.ts
 */
import {
  boardRowAriaLabel,
  boardRowDetailsAriaLabel,
} from "../src/lib/board-row-a11y";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  boardRowAriaLabel({ name: "McDavid", rank: 1, positionRank: 1 }, "ALL", 0) ===
    "McDavid, rank 1",
  "overall",
);
assert(
  boardRowAriaLabel(
    { name: "McDavid", rank: 1, positionRank: 2 },
    "C",
    0,
  ) === "McDavid, position rank 2",
  "position",
);
assert(
  boardRowAriaLabel({ name: "X", rank: 9 }, "D", 3) ===
    "X, position rank 4",
  "fallback index",
);
assert(
  boardRowDetailsAriaLabel("McDavid") === "McDavid details",
  "details region",
);

if (failed) process.exit(1);
console.log("OK: board-row-a11y");
