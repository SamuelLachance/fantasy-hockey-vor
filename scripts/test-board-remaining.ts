/**
 * Unit checks for remaining board row counts.
 * Run: npx tsx scripts/test-board-remaining.ts
 */
import { remainingBoardRows } from "../src/lib/board-remaining";

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

if (failed) process.exit(1);
console.log("OK: board-remaining");
