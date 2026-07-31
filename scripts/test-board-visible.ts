/**
 * Unit checks for progressive board window slicing.
 * Run: npx tsx scripts/test-board-visible.ts
 */
import { visibleBoardPlayers } from "../src/lib/board-visible";
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

if (failed) process.exit(1);
console.log("OK: board-visible");
