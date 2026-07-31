/**
 * Unit checks for progressive board window slicing.
 * Run: npx tsx scripts/test-board-visible.ts
 */
import {
  boardRowTabStopId,
  visibleBoardPlayers,
} from "../src/lib/board-visible";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const players = [{ id: 1 }, { id: 2 }, { id: 3 }] as PlayerProjection[];
assert(visibleBoardPlayers(players, 2).map((p) => p.id).join() === "1,2", "slice");
assert(visibleBoardPlayers(players, 10).length === 3, "cap to filtered");
assert(visibleBoardPlayers(players, -1).length === 0, "neg → empty");
assert(visibleBoardPlayers([], 5).length === 0, "empty filtered");

assert(boardRowTabStopId(players, null) === 1, "first row tab stop");
assert(boardRowTabStopId(players, 2) === 2, "expanded tab stop");
assert(boardRowTabStopId(players, 99) === 1, "missing expand → first");
assert(boardRowTabStopId([], null) === null, "empty no tab stop");
assert(
  boardRowTabStopId(players, null, 3) === 3,
  "collapse keeps anchor tab stop",
);
assert(
  boardRowTabStopId(players, null, 99) === 1,
  "missing anchor → first",
);

if (failed) process.exit(1);
console.log("OK: board-visible");
