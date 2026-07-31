/**
 * Unit checks for board j/k expansion navigation.
 * Run: npx tsx scripts/test-board-keyboard.ts
 */
import { nextExpandedPlayerId, isBoardRowToggleKey } from "../src/lib/board-keyboard";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const ids = [10, 20, 30];

assert(nextExpandedPlayerId([], null, 1) === null, "empty list");
assert(nextExpandedPlayerId(ids, null, 1) === 10, "j opens first");
assert(nextExpandedPlayerId(ids, null, -1) === 30, "k opens last");
assert(nextExpandedPlayerId(ids, 10, 1) === 20, "j next");
assert(nextExpandedPlayerId(ids, 20, -1) === 10, "k prev");
assert(nextExpandedPlayerId(ids, 10, -1) === 10, "k at first stays");
assert(nextExpandedPlayerId(ids, 30, 1) === 30, "j at last stays");
assert(nextExpandedPlayerId(ids, 999, 1) === 10, "missing id → first");
assert(nextExpandedPlayerId(ids, 999, -1) === 30, "missing id → last");
assert(isBoardRowToggleKey("Enter"), "Enter toggles");
assert(isBoardRowToggleKey(" "), "Space toggles");
assert(!isBoardRowToggleKey("a"), "letter no toggle");

if (failed) process.exit(1);
console.log("OK: board-keyboard");
