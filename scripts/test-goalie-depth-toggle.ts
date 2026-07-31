/**
 * Unit checks for depth-goalie toolbar visibility.
 * Run: npx tsx scripts/test-goalie-depth-toggle.ts
 */
import { canToggleDepthGoalies } from "../src/lib/goalie-depth-toggle";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(canToggleDepthGoalies("ALL"), "ALL");
assert(canToggleDepthGoalies("G"), "G");
assert(!canToggleDepthGoalies("C"), "C");
assert(!canToggleDepthGoalies("D"), "D");

if (failed) process.exit(1);
console.log("OK: goalie-depth-toggle");
