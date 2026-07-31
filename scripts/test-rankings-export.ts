/**
 * Unit checks for board JSON export rows.
 * Run: npx tsx scripts/test-rankings-export.ts
 */
import {
  downloadRankingsCsv,
  downloadRankingsJson,
  rankingsJsonExport,
  rankingsToJsonRows,
} from "../src/lib/rankings-export";
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
  vorByPosition: { C: 1.23456, LW: 0.5 },
  draftValue: 4,
  gamesPlayed: 80,
  uncertainty: { total: { sigma: 41.2 } },
} as unknown as PlayerProjection;

const rows = rankingsToJsonRows([sample], "C");
assert(rows[0]!.rank === 2, "position rank");
assert(rows[0]!.vor === 1.235, "position VOR not overall");
assert(rows[0]!.sigma === 41.2, "sigma");
assert(rows[0]!.edge === 4, "edge");
assert(
  rankingsToJsonRows([sample], "ALL")[0]!.vor === 3.142,
  "ALL uses overall VOR",
);

const bundle = rankingsJsonExport([sample], "C", "2026-07-30T00:00:00.000Z");
assert(bundle.filterPosition === "C", "bundle filter");
assert(bundle.vorScope === "position", "bundle vorScope");
assert(bundle.playerCount === 1, "bundle count");
assert(bundle.players[0]!.vor === 1.235, "bundle rows");
assert(bundle.exportedAt.startsWith("2026"), "bundle timestamp");
assert(
  rankingsJsonExport([sample], "ALL").vorScope === "overall",
  "ALL overall scope",
);

assert(typeof downloadRankingsCsv === "function", "csv download helper");
assert(typeof downloadRankingsJson === "function", "json download helper");

if (failed) process.exit(1);
console.log("OK: rankings-export");
