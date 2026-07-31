/**
 * Unit check: inactive denylist filter.
 * Run: npx tsx scripts/test-inactive-players.ts
 */
import { filterActivePlayers, loadInactivePlayerIds } from "../src/lib/inactive-players";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const ids = loadInactivePlayerIds();
assert(ids.has(8474053), "Couture id listed");
const kept = filterActivePlayers([
  { id: 8474053 },
  { id: 8480014 },
]);
assert(kept.length === 1 && kept[0]!.id === 8480014, "filters Couture");

if (failed) process.exit(1);
console.log("OK: inactive-players");
