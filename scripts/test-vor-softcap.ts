/**
 * Unit checks for peripheral VOR soft-cap.
 * Run: npx tsx scripts/test-vor-softcap.ts
 */
import { softCapCategoryZ } from "../src/lib/vor";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(softCapCategoryZ("goals", 5) === 5, "scoring cats uncapped");
assert(softCapCategoryZ("hits", 0) === 0, "zero stays zero");
const soft = softCapCategoryZ("hits", 6);
assert(soft < 6 && soft > 2.5, `hits z=6 softens to ~cap (got ${soft})`);
assert(
  Math.abs(softCapCategoryZ("blocks", 1) - Math.tanh(1 / 2.75) * 2.75) < 1e-9,
  "blocks matches tanh formula",
);
assert(
  softCapCategoryZ("hits", 10) < softCapCategoryZ("hits", 6) + 0.5,
  "diminishing returns at extreme",
);

if (failed) process.exit(1);
console.log("OK: vor-softcap");
