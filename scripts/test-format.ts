/**
 * Unit checks for display color helpers.
 * Run: npx tsx scripts/test-format.ts
 */
import { edgeColor, sigmaColor, vorColor } from "../src/lib/format";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(vorColor(5).includes("emerald"), "high VOR emerald");
assert(vorColor(2.5).includes("cyan"), "mid VOR cyan");
assert(vorColor(0.5).includes("slate"), "small VOR slate");
assert(vorColor(-1).includes("rose"), "neg VOR rose");
assert(edgeColor(3).includes("emerald"), "pos edge");
assert(edgeColor(-2).includes("rose"), "neg edge");
assert(edgeColor(0).includes("slate"), "zero edge");
assert(sigmaColor(30).includes("emerald"), "low sigma");
assert(sigmaColor(55).includes("slate"), "mid sigma");
assert(sigmaColor(85).includes("amber"), "high sigma");
assert(sigmaColor(120).includes("rose"), "very high sigma");

if (failed) process.exit(1);
console.log("OK: format");
