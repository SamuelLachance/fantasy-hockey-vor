/**
 * Unit checks for board player id helpers.
 * Run: npx tsx scripts/test-board-players.ts
 */
import { boardHasPlayerId } from "../src/lib/board-players";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const players = [{ id: 1 }, { id: 2 }];
assert(boardHasPlayerId(players, 1), "finds id");
assert(!boardHasPlayerId(players, 3), "missing id");
assert(!boardHasPlayerId(players, null), "null");
assert(!boardHasPlayerId(players, undefined), "undefined");
assert(!boardHasPlayerId([], 1), "empty list");

if (failed) process.exit(1);
console.log("OK: board-players");
