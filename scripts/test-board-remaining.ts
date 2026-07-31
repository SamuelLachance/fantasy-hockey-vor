/**
 * Unit checks for remaining board row counts.
 * Run: npx tsx scripts/test-board-remaining.ts
 */
import {
  loadMoreAriaLabel,
  loadMoreLabel,
  remainingBoardRows,
} from "../src/lib/board-remaining";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(remainingBoardRows(200, 100) === 100, "half remaining");
assert(remainingBoardRows(50, 50) === 0, "none remaining");
assert(remainingBoardRows(10, 50) === 0, "never negative");
assert(remainingBoardRows(0, 0) === 0, "empty");
assert(loadMoreLabel(42) === "Load more · 42 left", "label");
assert(
  loadMoreAriaLabel(42) === "Load more players, 42 remaining",
  "aria label",
);

if (failed) process.exit(1);
console.log("OK: board-remaining");
