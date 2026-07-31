/**
 * Unit check: inactive denylist filter + file consistency.
 * Run: npx tsx scripts/test-inactive-players.ts
 */
import {
  filterActivePlayers,
  inactiveFileIssues,
  loadInactivePlayerIds,
  loadInactivePlayersFile,
} from "../src/lib/inactive-players";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const ids = loadInactivePlayerIds();
assert(ids.has(8474053), "Couture id listed");
assert(ids.has(8476346), "Gaudreau id listed");
assert(ids.has(8470794), "Pavelski id listed");
assert(ids.has(8473604), "Toews id listed");
assert(ids.has(8470966), "Giordano id listed");
assert(ids.has(8470600), "Suter id listed");
assert(ids.has(8471698), "Oshie id listed");
assert(ids.has(8475744), "Kuznetsov id listed");
assert(ids.has(8479415), "McLeod id listed");
assert(ids.has(8479376), "Mete id listed");
const kept = filterActivePlayers([
  { id: 8474053 },
  { id: 8480014 },
]);
assert(kept.length === 1 && kept[0]!.id === 8480014, "filters Couture");

const file = loadInactivePlayersFile();
const issues = inactiveFileIssues(file);
assert(issues.length === 0, `denylist issues: ${issues.join("; ")}`);
assert(
  (file.names?.length ?? 0) === file.ids.length,
  "names aligned with ids",
);

assert(
  inactiveFileIssues({
    reason: "x",
    ids: [1, 1],
    names: ["A", "B"],
  }).some((m) => m.includes("duplicate ids")),
  "detects duplicate ids",
);
assert(
  inactiveFileIssues({
    reason: "x",
    ids: [1, 2],
  }).some((m) => m.includes("names array required")),
  "requires names when ids present",
);
assert(
  inactiveFileIssues({
    reason: "x",
    ids: [1, 2],
    names: ["OnlyOne"],
  }).some((m) => m.includes("names length")),
  "detects names/ids length mismatch",
);

if (failed) process.exit(1);
console.log("OK: inactive-players");
