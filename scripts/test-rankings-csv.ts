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
assert(csv.startsWith("rank,name,team,positions,vor,edge,gp,G,A"), "header");
const dataLine = csv.split("\n")[1] ?? "";
assert(dataLine.includes('"A, ""Test"""'), "escaped name");
assert(dataLine.startsWith("1,"), "positionRank when pos=C");
assert(csv.split("\n").length === 2, "one data row");

if (failed) process.exit(1);
console.log("OK: rankings-csv");
