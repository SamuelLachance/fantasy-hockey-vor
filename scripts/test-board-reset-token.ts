/**
 * Unit checks for infinite-scroll filter reset tokens.
 * Run: npx tsx scripts/test-board-reset-token.ts
 */
import { boardFilterResetToken } from "../src/lib/board-reset-token";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const base = boardFilterResetToken("ALL", "mcdavid", {}, true, "vor", "desc");
const depthOn = boardFilterResetToken("ALL", "mcdavid", {}, false, "vor", "desc");
const pos = boardFilterResetToken("G", "mcdavid", {}, true, "vor", "desc");
const ranges = boardFilterResetToken(
  "ALL",
  "mcdavid",
  { vor: { min: "1", max: "" } },
  true,
  "vor",
  "desc",
);
const sortEdge = boardFilterResetToken(
  "ALL",
  "mcdavid",
  {},
  true,
  "draftValue",
  "desc",
);
const sortDir = boardFilterResetToken("ALL", "mcdavid", {}, true, "vor", "asc");

assert(base !== depthOn, "hideDepthGoalies changes token");
assert(base !== pos, "position changes token");
assert(base !== ranges, "stat ranges change token");
assert(base !== sortEdge, "sort key changes token");
assert(base !== sortDir, "sort dir changes token");
assert(base.includes("g1"), "starters token marks g1");
assert(depthOn.includes("g0"), "all goalies token marks g0");
assert(
  boardFilterResetToken("C", "  Foo ", {}, true, "vor", "desc") ===
    boardFilterResetToken("C", "foo", {}, true, "vor", "desc"),
  "query normalized",
);

if (failed) process.exit(1);
console.log("OK: board-reset-token");
