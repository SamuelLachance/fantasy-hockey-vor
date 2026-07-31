/**
 * Unit checks for empty-board recovery action flags.
 * Run: npx tsx scripts/test-board-empty-recovery.ts
 */
import {
  emptyBoardHintCopy,
  emptyBoardRecoveryFlags,
  emptyBoardStatusCopy,
} from "../src/lib/board-empty-recovery";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const none = emptyBoardRecoveryFlags({
  query: "",
  activeFilterCount: 0,
  position: "ALL",
  canShowAllGoalies: false,
});
assert(!none.clearSearch, "no search");
assert(!none.clearStatFilters, "no filters");
assert(!none.showAllPositions, "already ALL");
assert(!none.showAllGoalies, "no depth path");

const all = emptyBoardRecoveryFlags({
  query: " mcdavid ",
  activeFilterCount: 2,
  position: "C",
  canShowAllGoalies: true,
});
assert(all.clearSearch, "has search");
assert(all.clearStatFilters, "has filters");
assert(all.showAllPositions, "pos filter");
assert(all.showAllGoalies, "depth path");
assert(
  emptyBoardStatusCopy().includes("No players match"),
  "status copy",
);
assert(emptyBoardHintCopy().includes("Press r"), "hint mentions r");
assert(emptyBoardHintCopy().includes("Esc"), "hint mentions Esc");

if (failed) process.exit(1);
console.log("OK: board-empty-recovery");
