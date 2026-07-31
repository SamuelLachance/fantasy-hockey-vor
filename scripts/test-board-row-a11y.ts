/**
 * Unit checks for board row accessible names.
 * Run: npx tsx scripts/test-board-row-a11y.ts
 */
import {
  boardRowAriaLabel,
  boardRowDetailsAriaLabel,
  boardTableAriaLabel,
  boardTableAriaRowCount,
  boardTableAriaRowIndex,
  edgeCellTitle,
  sigmaCellDisplay,
  sigmaCellTitle,
} from "../src/lib/board-row-a11y";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  boardRowAriaLabel({ name: "McDavid", rank: 1, positionRank: 1 }, "ALL", 0) ===
    "McDavid, rank 1",
  "overall",
);
assert(
  boardRowAriaLabel(
    { name: "McDavid", rank: 1, positionRank: 2 },
    "C",
    0,
  ) === "McDavid, position rank 2",
  "position",
);
assert(
  boardRowAriaLabel({ name: "X", rank: 9 }, "D", 3) ===
    "X, position rank 4",
  "fallback index",
);
assert(
  boardRowDetailsAriaLabel("McDavid") === "McDavid details",
  "details region",
);
assert(
  edgeCellTitle(10, 3) === "Consensus rank 10 − model rank 3",
  "edge title",
);
assert(edgeCellTitle(null, 3) === undefined, "edge no consensus");
assert(
  sigmaCellTitle(41.2) === "Σσ 41.2 (lower = more confident)",
  "sigma title",
);
assert(sigmaCellTitle(null) === "No calibrated uncertainty", "sigma missing");
assert(sigmaCellDisplay(41.2) === "41", "sigma display");
assert(sigmaCellDisplay(null) === "—", "sigma em dash");
assert(boardTableAriaRowCount(0) === undefined, "rowcount empty");
assert(boardTableAriaRowCount(10) === 11, "rowcount includes header");
assert(boardTableAriaRowIndex(0) === 2, "first data row after header");
assert(boardTableAriaRowIndex(49) === 51, "fiftieth data row");
assert(
  boardTableAriaLabel("ALL") === "Fantasy hockey VOR rankings",
  "table label all",
);
assert(
  boardTableAriaLabel("C") === "Fantasy hockey VOR rankings · C",
  "table label position",
);
assert(
  boardTableAriaLabel("G") === "Fantasy hockey VOR rankings · G",
  "table label G",
);

if (failed) process.exit(1);
console.log("OK: board-row-a11y");
