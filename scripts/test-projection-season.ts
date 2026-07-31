/**
 * Unit checks for NHL projection season constants.
 * Run: npx tsx scripts/test-projection-season.ts
 */
import {
  PROJECTION_SEASON,
  PROJECTION_SEASON_ID,
} from "../src/lib/nhl-api";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(/^\d{4}-\d{2}$/.test(PROJECTION_SEASON), "season label shape");
assert(Number.isInteger(PROJECTION_SEASON_ID), "season id int");
assert(PROJECTION_SEASON_ID === 20262027, "current season id");
assert(PROJECTION_SEASON === "2026-27", "current season label");

const [start, end] = PROJECTION_SEASON.split("-").map(Number);
assert(end === (start! % 100) + 1, "end year follows start");
assert(
  PROJECTION_SEASON_ID === start! * 10000 + (2000 + end!),
  "id encodes YYYY + YY",
);

if (failed) process.exit(1);
console.log("OK: projection-season");
