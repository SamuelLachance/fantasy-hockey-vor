/**
 * Unit checks for depth-goalie toolbar visibility.
 * Run: npx tsx scripts/test-goalie-depth-toggle.ts
 */
import {
  canOfferAllGoalies,
  canToggleDepthGoalies,
  goalieDepthToggleAriaLabel,
  goalieDepthToggleLabel,
  goalieDepthToggleTitle,
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
assert(
  goalieDepthToggleAriaLabel(true) === "Starter goalies only",
  "starters aria",
);
assert(
  goalieDepthToggleAriaLabel(false) === "All goalies including depth",
  "all G aria",
);
assert(
  goalieDepthToggleTitle(8) ===
    "Hide org-depth goalies at 4–8 GP (Shift+G)",
  "toggle title starters",
);
assert(
  goalieDepthToggleTitle(8, false).includes("Showing all goalies"),
  "toggle title all G",
);

if (failed) process.exit(1);
console.log("OK: goalie-depth-toggle");
