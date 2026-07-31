/**
 * Unit check: board scroll helpers / sticky shadow constant.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import {
  STICKY_NAME_SHADOW,
  focusStatsFilterButton,
  scrollPageTop,
  scrollToRankings,
} from "../src/lib/board-dom";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  STICKY_NAME_SHADOW.includes("shadow-"),
  "sticky shadow class present",
);
assert(
  typeof STICKY_NAME_SHADOW === "string" && STICKY_NAME_SHADOW.length > 10,
  "sticky shadow non-empty",
);

// Node has no document/window — helpers must no-op without throwing.
try {
  focusStatsFilterButton();
  scrollPageTop();
  scrollToRankings();
} catch (e) {
  assert(false, `board-dom helpers threw in Node: ${e}`);
}

if (failed) process.exit(1);
console.log("OK: board-dom");
