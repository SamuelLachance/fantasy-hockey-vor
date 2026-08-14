/**
 * Unit checks for board player id helpers.
 * Run: npx tsx scripts/test-board-players.ts
 */
import {
  boardHasPlayerId,
  coerceExpandedPlayerId,
  hiddenLinkedPlayer,
  boardCopyPlayerLinkId,
  linkedPlayerChipName,
  nextDeferredExpandState,
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

const all = [{ id: 1 }, { id: 2 }, { id: 3 }];
const starters = [{ id: 1 }, { id: 2 }];
assert(
  JSON.stringify(
    nextDeferredExpandState({
      allPlayers: all,
      filtered: starters,
      expandedId: 3,
      pendingPlayerId: 3,
    }),
  ) === JSON.stringify({ expandedId: null, pendingPlayerId: 3 }),
  "park depth-hidden expand",
);
assert(
  JSON.stringify(
    nextDeferredExpandState({
      allPlayers: all,
      filtered: all,
      expandedId: null,
      pendingPlayerId: 3,
    }),
  ) === JSON.stringify({ expandedId: 3, pendingPlayerId: 3 }),
  "restore when filters reveal player",
);
assert(
  JSON.stringify(
    nextDeferredExpandState({
      allPlayers: all,
      filtered: starters,
      expandedId: 1,
      pendingPlayerId: 1,
    }),
  ) === JSON.stringify({ expandedId: 1, pendingPlayerId: 1 }),
  "keep visible expand",
);
assert(
  JSON.stringify(
    nextDeferredExpandState({
      allPlayers: all,
      filtered: starters,
      expandedId: 99,
      pendingPlayerId: 99,
    }),
  ) === JSON.stringify({ expandedId: null, pendingPlayerId: null }),
  "drop id missing from dataset",
);
assert(
  hiddenLinkedPlayer(all, 3, null)?.id === 3,
  "parked pending is a hidden linked player",
);
assert(
  hiddenLinkedPlayer(all, 3, 3) === null,
  "expanded pending is not hidden",
);
assert(hiddenLinkedPlayer(all, null, null) === null, "no pending");
assert(boardCopyPlayerLinkId(1, 3) === 1, "copy prefers expanded");
assert(boardCopyPlayerLinkId(null, 3) === 3, "copy falls back to pending");
assert(boardCopyPlayerLinkId(null, null) === null, "copy none");
assert(
  linkedPlayerChipName("Beta", 10) === "Beta",
  "chip when board has rows",
);
assert(linkedPlayerChipName("Beta", 0) === null, "no chip on empty board");
assert(linkedPlayerChipName(null, 10) === null, "no chip without name");

if (failed) process.exit(1);
console.log("OK: board-players");
