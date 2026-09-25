/**
 * Unit checks for diacritic-folding search (the player explorer and the
 * draft board both fold names this way).
 * Run: npx tsx scripts/test-search-fold.ts
 */
import { foldSearchText, foldSearchTextWithMap } from "../src/lib/search-fold";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(foldSearchText("Stützle") === "stutzle", "fold ü");
assert(foldSearchText("Lafrenière") === "lafreniere", "fold è");
assert(foldSearchText("STUTZLE") === "stutzle", "fold case");
assert(foldSearchText("Juraj Slafkovský") === "juraj slafkovsky", "fold ý");
assert(foldSearchText("Zegras") === "zegras", "ASCII unchanged");

const mapped = foldSearchTextWithMap("Stützle");
assert(mapped.folded === "stutzle", "map folded");
assert(mapped.map.length === mapped.folded.length, "map length");
assert(mapped.map[2] === 2 && mapped.map[3] === 3, "map points at the original characters");
assert(foldSearchTextWithMap("Stützle") === mapped, "fold map cache returns the same object");

// Any accented query hits the same folded name as its ASCII spelling.
const name = foldSearchText("Tim Stützle");
assert(name.includes(foldSearchText("stütz")) && name.includes(foldSearchText("stutz")), "accented and ASCII queries both hit");

if (failed) process.exit(1);
console.log("OK: search-fold");
