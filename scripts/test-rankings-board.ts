/**
 * Unit checks for pure board filter/sort.
 * Run: npx tsx scripts/test-rankings-board.ts
 */
import {
  coerceSortKeyForPosition,
  filterAndSortBoard,
  pruneStatRangesForPosition,
} from "../src/lib/rankings-board";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const players = [
  {
    id: 1,
    name: "Alpha",
    team: "EDM",
    positions: ["C"],
    isGoalie: false,
    gamesPlayed: 80,
    vor: 5,
    rank: 1,
    draftValue: 2,
    uncertainty: { total: { sigma: 40 } },
  },
  {
    id: 2,
    name: "Beta",
    team: "TOR",
    positions: ["G"],
    isGoalie: true,
    gamesPlayed: 4,
    vor: 1,
    rank: 2,
    draftValue: 0,
    uncertainty: { total: { sigma: 20 } },
  },
  {
    id: 3,
    name: "Gamma",
    team: "EDM",
    positions: ["D"],
    isGoalie: false,
    gamesPlayed: 75,
    vor: 3,
    rank: 3,
    draftValue: 10,
    uncertainty: { total: { sigma: 30 } },
  },
] as unknown as PlayerProjection[];

const base = {
  position: "ALL" as const,
  query: "",
  sortKey: "vor" as const,
  sortDir: "desc" as const,
  statRanges: {},
  hideDepthGoalies: true,
};

const starters = filterAndSortBoard(players, base);
assert(starters.length === 2, "depth G hidden");
assert(starters[0]!.name === "Alpha", "VOR desc");

const bySigma = filterAndSortBoard(players, {
  ...base,
  hideDepthGoalies: false,
  sortKey: "sigma",
  sortDir: "asc",
});
assert(bySigma[0]!.name === "Beta", "sigma asc");

const edm = filterAndSortBoard(players, { ...base, query: "edm" });
assert(edm.length === 2 && edm.every((p) => p.team === "EDM"), "team search");

const edgeMin = filterAndSortBoard(players, {
  ...base,
  statRanges: { draftValue: { min: "5", max: "" } },
});
assert(edgeMin.length === 1 && edgeMin[0]!.name === "Gamma", "edge filter");

assert(coerceSortKeyForPosition("vor", "D") === "vor", "core sort kept");
assert(
  coerceSortKeyForPosition("faceoffWins", "D") === "vor",
  "FOW invalid on D → vor",
);
assert(
  coerceSortKeyForPosition("faceoffWins", "C") === "faceoffWins",
  "FOW valid on C",
);
assert(coerceSortKeyForPosition("wins", "G") === "wins", "wins valid on G");
assert(coerceSortKeyForPosition("wins", "ALL") === "vor", "wins invalid on ALL");

const gRanges = {
  wins: { min: "20", max: "" },
  vor: { min: "1", max: "" },
};
const prunedC = pruneStatRangesForPosition(gRanges, "C");
assert(prunedC.wins === undefined, "prune drops wins on C");
assert(prunedC.vor?.min === "1", "prune keeps vor on C");
assert(
  pruneStatRangesForPosition(gRanges, "G") === gRanges,
  "prune same ref when unchanged",
);

const twins = [
  {
    id: 20,
    name: "Zed",
    team: "EDM",
    positions: ["C"],
    isGoalie: false,
    gamesPlayed: 80,
    vor: 1,
    rank: 20,
    draftValue: 0,
  },
  {
    id: 10,
    name: "Amy",
    team: "EDM",
    positions: ["C"],
    isGoalie: false,
    gamesPlayed: 80,
    vor: 1,
    rank: 10,
    draftValue: 0,
  },
] as unknown as PlayerProjection[];
const byTeam = filterAndSortBoard(twins, {
  ...base,
  sortKey: "team",
  sortDir: "asc",
});
assert(byTeam.map((p) => p.id).join() === "10,20", "tie-break by rank");
const byTeamRev = filterAndSortBoard([...twins].reverse(), {
  ...base,
  sortKey: "team",
  sortDir: "asc",
});
assert(
  byTeamRev.map((p) => p.id).join() === "10,20",
  "tie-break stable vs input order",
);

if (failed) process.exit(1);
console.log("OK: rankings-board");
