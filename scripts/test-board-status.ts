/**
 * Unit checks for board status summary copy.
 * Run: npx tsx scripts/test-board-status.ts
 */
import {
  boardInteractionTipCopy,
  boardShowingSummary,
  rankingsSectionHeadingCopy,
} from "../src/lib/board-status";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  boardShowingSummary(50, 200, 1311) ===
    "Showing 50 of 200 matching players (1,311 total).",
  "basic summary",
);
assert(
  boardShowingSummary(300, 200, 1311) ===
    "Showing 200 of 200 matching players (1,311 total).",
  "render capped to filtered",
);
assert(
  boardShowingSummary(-1, -5, 0) ===
    "Showing 0 of 0 matching players (0 total).",
  "clamps negatives",
);
assert(
  boardShowingSummary(50, 200, 1311, { searchPending: true }).endsWith(
    "Updating…",
  ),
  "pending suffix",
);
assert(
  !boardShowingSummary(50, 200, 1311, { searchPending: false }).includes(
    "Updating",
  ),
  "settled has no pending suffix",
);
assert(
  boardShowingSummary(50, 200, 1311, { linkedPlayerName: "Beta" }).includes(
    "Beta is hidden by the current filters",
  ),
  "linked player announced in summary",
);
assert(
  boardInteractionTipCopy().includes("Enter/Space"),
  "tip mentions Enter/Space",
);
assert(
  boardInteractionTipCopy().includes("column headers"),
  "tip mentions sort headers",
);
assert(rankingsSectionHeadingCopy() === "VOR rankings", "section heading");

if (failed) process.exit(1);
console.log("OK: board-status");
