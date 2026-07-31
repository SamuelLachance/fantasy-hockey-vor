/**
 * Unit checks for board player id helpers.
 * Run: npx tsx scripts/test-board-players.ts
 */
import {
  boardHasPlayerId,
  coerceExpandedPlayerId,
} from "../src/lib/board-players";

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

assert(coerceExpandedPlayerId(players, 1) === 1, "keep expand in list");
assert(coerceExpandedPlayerId(players, 9) === null, "clear expand missing");
assert(coerceExpandedPlayerId(players, null) === null, "null stays null");
assert(
  coerceExpandedPlayerId([{ id: 2 }], 1) === null,
  "clear when filtered out",
);

if (failed) process.exit(1);
console.log("OK: board-players");
