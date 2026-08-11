/**
 * Unit checks for pure board filter/sort.
 * Run: npx tsx scripts/test-rankings-board.ts
 */
import {
  coerceSortKeyForPosition,
  filterAndSortBoard,
  pruneStatRangesForPosition,
} from "../src/lib/rankings-board";
import { rankForFilter } from "../src/lib/rankings-filters";
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

// Two players both missing the sorted value: the Infinity sentinels subtract
// to NaN, which used to short-circuit the tie-break and leave ordering at the
// mercy of input order.
const noSigma = [
  { id: 30, name: "Delta", team: "BOS", positions: ["C"], isGoalie: false, gamesPlayed: 70, vor: 2, rank: 4 },
  { id: 40, name: "Epsilon", team: "BOS", positions: ["C"], isGoalie: false, gamesPlayed: 70, vor: 2, rank: 5 },
] as unknown as PlayerProjection[];
const sigmaSorted = filterAndSortBoard(noSigma, { ...base, sortKey: "sigma", sortDir: "asc" });
const sigmaSortedRev = filterAndSortBoard([...noSigma].reverse(), {
  ...base,
  sortKey: "sigma",
  sortDir: "asc",
});
assert(
  sigmaSorted.map((p) => p.id).join() === "30,40",
  "missing sigma falls back to rank order",
);
assert(
  sigmaSortedRev.map((p) => p.id).join() === "30,40",
  "missing-sigma order is input-order independent",
);

// Position-filtered rank must come from the filtered position, not the
// player's best slot — otherwise dual-eligible players duplicate rank numbers.
const dual = [
  {
    id: 50, name: "Zeta", team: "EDM", position: "LW", positions: ["C", "LW"],
    isGoalie: false, gamesPlayed: 80, vor: 9, rank: 1, positionRank: 1,
    positionRanks: { C: 2, LW: 1 },
    vorByPosition: { C: 9, LW: 9 },
  },
  {
    id: 60, name: "Eta", team: "TOR", position: "C", positions: ["C"],
    isGoalie: false, gamesPlayed: 80, vor: 8, rank: 2, positionRank: 1,
    positionRanks: { C: 1 },
    vorByPosition: { C: 10 },
  },
] as unknown as PlayerProjection[];
const cBoard = filterAndSortBoard(dual, { ...base, position: "C", sortKey: "rank", sortDir: "asc" });
assert(
  cBoard.map((p) => p.id).join() === "60,50",
  "rank sort on the C tab uses C ranks",
);
assert(
  rankForFilter(dual[0]!, "C") === 2 && rankForFilter(dual[1]!, "C") === 1,
  "rankForFilter reads the filtered position",
);
assert(rankForFilter(dual[0]!, "ALL") === 1, "rankForFilter falls back to overall rank");
assert(
  rankForFilter(
    { rank: 7, positionRank: 3, position: "D" } as unknown as PlayerProjection,
    "D",
  ) === 3,
  "legacy rows without positionRanks still resolve",
);

if (failed) process.exit(1);
console.log("OK: rankings-board");
