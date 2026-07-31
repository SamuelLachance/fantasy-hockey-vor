/**
 * Unit checks for board JSON export rows.
 * Run: npx tsx scripts/test-rankings-export.ts
 */
import { rankingsToJsonRows } from "../src/lib/rankings-export";
import type { PlayerProjection } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const sample = {
  id: 99,
  rank: 5,
  positionRank: 2,
  name: "Test",
  team: "EDM",
  positions: ["C"],
  vor: 3.14159,
  draftValue: 4,
  gamesPlayed: 80,
  uncertainty: { total: { sigma: 41.2 } },
} as unknown as PlayerProjection;

const rows = rankingsToJsonRows([sample], "C");
assert(rows[0]!.rank === 2, "position rank");
assert(rows[0]!.vor === 3.142, "vor rounded");
assert(rows[0]!.sigma === 41.2, "sigma");
assert(rows[0]!.edge === 4, "edge");

if (failed) process.exit(1);
console.log("OK: rankings-export");
