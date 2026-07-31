/**
 * Unit checks for board position tab navigation.
 * Run: npx tsx scripts/test-board-positions.ts
 */
import {
  BOARD_POSITIONS,
  cycleBoardPosition,
  nextBoardPositionIndex,
} from "../src/lib/board-positions";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(BOARD_POSITIONS[0] === "ALL", "ALL first");
assert(BOARD_POSITIONS.includes("G"), "G present");
assert(nextBoardPositionIndex(0, "ArrowRight") === 1, "right from ALL");
assert(nextBoardPositionIndex(5, "ArrowRight") === 0, "right wraps");
assert(nextBoardPositionIndex(0, "ArrowLeft") === 5, "left wraps");
assert(nextBoardPositionIndex(3, "Home") === 0, "Home");
assert(nextBoardPositionIndex(1, "End") === 5, "End");
assert(nextBoardPositionIndex(-1, "ArrowRight") === 0, "negative index normalize");
assert(cycleBoardPosition("ALL", 1) === "C", "cycle ALL → C");
assert(cycleBoardPosition("G", 1) === "ALL", "cycle G wraps to ALL");
assert(cycleBoardPosition("C", -1) === "ALL", "cycle back to ALL");
assert(cycleBoardPosition("LW", -1) === "C", "cycle LW → C");

if (failed) process.exit(1);
console.log("OK: board-positions");
