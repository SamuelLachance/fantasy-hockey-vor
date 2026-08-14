/**
 * Unit checks for diacritic-folding board search.
 * Run: npx tsx scripts/test-search-fold.ts
 */
import { foldSearchText, foldSearchTextWithMap } from "../src/lib/search-fold";
import {
  filterAndSortBoard,
  foldedBoardSearchFields,
} from "../src/lib/rankings-board";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(foldSearchText("Stützle") === "stutzle", "fold ü");
assert(foldSearchText("Lafrenière") === "lafreniere", "fold è");
assert(foldSearchText("STUTZLE") === "stutzle", "fold case");

const mapped = foldSearchTextWithMap("Stützle");
assert(mapped.folded === "stutzle", "map folded");
assert(mapped.map.length === mapped.folded.length, "map length");
assert(
  foldSearchTextWithMap("Stützle") === mapped,
  "fold map cache returns the same object",
);

const players = [
  {
    id: 1,
    name: "Tim Stützle",
    team: "OTT",
    position: "C",
    positions: ["C", "LW"],
    rank: 1,
    vor: 10,
    gamesPlayed: 82,
  },
  {
    id: 2,
    name: "Connor McDavid",
    team: "EDM",
    position: "C",
    positions: ["C"],
    rank: 2,
    vor: 20,
    gamesPlayed: 82,
  },
] as unknown as PlayerProjection[];

const hits = filterAndSortBoard(players, {
  position: "ALL",
  query: "stutzle",
  sortKey: "vor",
  sortDir: "desc",
  hideDepthGoalies: true,
  statRanges: {},
});
assert(hits.length === 1 && hits[0]!.name === "Tim Stützle", "ascii query hits");

const accentHits = filterAndSortBoard(players, {
  position: "ALL",
  query: "stütz",
  sortKey: "vor",
  sortDir: "desc",
  hideDepthGoalies: true,
  statRanges: {},
});
assert(accentHits.length === 1, "accented query still hits");

const once = foldedBoardSearchFields(players[0]!);
const twice = foldedBoardSearchFields(players[0]!);
assert(once === twice, "folded name/team cache hits the same object");
assert(once[0] === "tim stutzle" && once[1] === "ott", "cached fold matches");

if (failed) process.exit(1);
console.log("OK: search-fold");
