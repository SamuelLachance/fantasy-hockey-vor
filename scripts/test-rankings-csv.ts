/**
 * Unit checks for rankings CSV export.
 * Run: npx tsx scripts/test-rankings-csv.ts
 */
import { rankingsToCsv } from "../src/lib/rankings-csv";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const sample = {
  id: 1,
  rank: 3,
  positionRank: 1,
  name: 'A, "Test"',
  team: "EDM",
  positions: ["C", "LW"],
  isGoalie: false,
  gamesPlayed: 80,
  vor: 5.5,
  vorByPosition: { C: 2.25, LW: 1.1 },
  draftValue: 12,
  projection: {
    goals: 40,
    assists: 70,
    shots: 300,
    blocks: 20,
    hits: 40,
    powerplayPoints: 25,
    penaltyMinutes: 30,
    faceoffWins: 500,
  },
  zScores: {},
  categoryScores: {},
} as unknown as PlayerProjection;

const csv = rankingsToCsv([sample], "C", ["goals", "assists"]);
const lines = csv.split("\n");
assert(
  lines[0]!.startsWith("# fantasy-hockey-vor;filter=C;vorScope=position"),
  "meta comment",
);
assert(
  lines[1] === "rank,name,team,positions,vor,edge,sigma,gp,G,A",
  "header",
);
const dataLine = lines[2] ?? "";
assert(dataLine.includes('"A, ""Test"""'), "escaped name");
assert(dataLine.startsWith("1,"), "positionRank when pos=C");
assert(dataLine.includes(",2.250,"), "CSV uses position VOR");
assert(
  rankingsToCsv([sample], "ALL", ["goals"])
    .split("\n")[0]!
    .includes("vorScope=overall"),
  "ALL meta overall scope",
);
assert(
  rankingsToCsv([sample], "ALL", ["goals"]).split("\n")[2]!.includes(",5.500,"),
  "ALL CSV uses overall VOR",
);
assert(lines.length === 3, "meta + header + one data row");

if (failed) process.exit(1);
console.log("OK: rankings-csv");
