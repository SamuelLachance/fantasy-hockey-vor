/**
 * Unit checks for depth-goalie toolbar visibility.
 * Run: npx tsx scripts/test-goalie-depth-toggle.ts
 */
import {
  canOfferAllGoalies,
  canToggleDepthGoalies,
  goalieDepthToggleLabel,
} from "../src/lib/goalie-depth-toggle";

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
assert(canOfferAllGoalies(true, "G"), "offer when starters+G");
assert(canOfferAllGoalies(true, "ALL"), "offer when starters+ALL");
assert(!canOfferAllGoalies(false, "G"), "no offer when already all G");
assert(!canOfferAllGoalies(true, "C"), "no offer on C");
assert(goalieDepthToggleLabel(true) === "Starters", "starters label");
assert(goalieDepthToggleLabel(false) === "All G", "all G label");

if (failed) process.exit(1);
console.log("OK: goalie-depth-toggle");
