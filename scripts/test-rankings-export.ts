/**
 * Unit checks for board JSON export rows.
 * Run: npx tsx scripts/test-rankings-export.ts
 */
import {
  downloadRankingsCsv,
  downloadRankingsJson,
  exportButtonLabel,
  exportButtonTitle,
  exportCategoryStat,
  exportGroupAriaLabel,
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
  position: "C",
  positions: ["C"],
  isGoalie: false,
  vor: 3.14159,
  vorByPosition: { C: 1.23456, LW: 0.5 },
  draftValue: 4,
  gamesPlayed: 80,
  uncertainty: { total: { sigma: 41.2 } },
  projection: { goals: 40, assists: 70, savePct: 0.91234 },
} as unknown as PlayerProjection;

const cats = ["goals", "assists"] as const;
const filters = {
  query: "mcd",
  sortKey: "vor" as const,
  sortDir: "desc" as const,
  hideDepthGoalies: true,
  statRanges: { vor: { min: "2", max: "" } },
};

const rows = rankingsToJsonRows([sample], "C", cats);
assert(rows[0]!.rank === 2, "position rank");
assert(rows[0]!.vor === 1.235, "position VOR not overall");
assert(rows[0]!.sigma === 41.2, "sigma");
assert(rows[0]!.edge === 4, "edge");
assert(rows[0]!.stats.goals === 40, "json stats goals");
assert(rows[0]!.stats.assists === 70, "json stats assists");
assert(
  rankingsToJsonRows([sample], "ALL", cats)[0]!.vor === 3.142,
  "ALL uses overall VOR",
);

const bundle = rankingsJsonExport(
  [sample],
  { position: "C", categories: cats, filters },
  "2026-07-30T00:00:00.000Z",
);
assert(bundle.filterPosition === "C", "bundle filter");
assert(bundle.vorScope === "position", "bundle vorScope");
assert(bundle.playerCount === 1, "bundle count");
assert(bundle.categories.join(",") === "goals,assists", "bundle categories");
assert(bundle.filters.query === "mcd", "bundle query provenance");
assert(bundle.filters.sortKey === "vor", "bundle sort provenance");
assert(bundle.filters.statRanges.vor?.min === "2", "bundle range provenance");
assert(bundle.players[0]!.vor === 1.235, "bundle rows");
assert(bundle.players[0]!.stats.goals === 40, "bundle stats");
assert(bundle.exportedAt.startsWith("2026"), "bundle timestamp");
assert(
  rankingsJsonExport([sample], {
    position: "ALL",
    categories: cats,
    filters,
  }).vorScope === "overall",
  "ALL overall scope",
);

assert(
  exportCategoryStat(
    {
      ...sample,
      isGoalie: true,
      position: "G",
      positions: ["G"],
      projection: { savePct: 0.91234, wins: 30, goalsAgainstAverage: 2.5 },
    } as unknown as PlayerProjection,
    "savePct",
  ) === 0.9123,
  "savePct rounds like CSV",
);
assert(exportCategoryStat(sample, "goals") === 40, "goals passthrough");
assert(
  exportCategoryStat(sample, "savePct") === null,
  "skater savePct inapplicable",
);

assert(typeof downloadRankingsCsv === "function", "csv download helper");
assert(typeof downloadRankingsJson === "function", "json download helper");
assert(exportButtonLabel("csv", "idle") === "CSV", "csv idle");
assert(exportButtonLabel("csv", "csv") === "Saved", "csv flash");
assert(exportButtonLabel("json", "csv") === "JSON", "json ignores csv flash");
assert(exportButtonLabel("json", "json") === "Saved", "json flash");
assert(exportGroupAriaLabel().includes("Export"), "group aria");
assert(exportButtonTitle("csv").includes("CSV"), "csv title");
assert(exportButtonTitle("json").includes("JSON"), "json title");
assert(
  exportButtonTitle("csv", { searchPending: true }).includes("search"),
  "pending title",
);

if (failed) process.exit(1);
console.log("OK: rankings-export");
