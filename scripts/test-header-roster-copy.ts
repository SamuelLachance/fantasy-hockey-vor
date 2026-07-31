/**
 * Unit checks for header roster note copy.
 * Run: npx tsx scripts/test-header-roster-copy.ts
 */
import { headerRosterCopy } from "../src/lib/header-roster-copy";
import type { LeagueSettings } from "../src/lib/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const def = headerRosterCopy();
assert(def.includes("2C · 2LW · 2RW · 4D · 2G"), "default roster slots");
assert(def.includes("Skater cats:"), "skater cats");
assert(def.includes("Goalie cats:"), "goalie cats");

const custom = headerRosterCopy({
  teams: 10,
  roster: { C: 1, LW: 1, RW: 1, D: 3, G: 1 },
  season: "2026-27",
  goalieVorFactor: 0.2,
} as LeagueSettings);
assert(custom.includes("1C · 1LW · 1RW · 3D · 1G"), "custom roster");

if (failed) process.exit(1);
console.log("OK: header-roster-copy");
