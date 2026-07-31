/**
 * Unit check: board scroll helpers / sticky shadow constant.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import {
  STICKY_NAME_SHADOW,
  focusPlayerRow,
  focusStatsFilterButton,
  prefersReducedMotion,
  scrollExpandedRowIntoView,
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
  STICKY_NAME_SHADOW.includes("group-data-[scrolled]/hscroll:shadow-"),
  "sticky shadow gated by scroll group",
);
assert(
  typeof STICKY_NAME_SHADOW === "string" && STICKY_NAME_SHADOW.length > 10,
  "sticky shadow non-empty",
);
assert(
  prefersReducedMotion() === true,
  "SSR/Node defaults to reduced motion",
);

// Node has no document/window — helpers must no-op without throwing.
try {
  focusStatsFilterButton();
  focusPlayerRow(1);
  scrollPageTop();
  scrollToRankings();
  scrollExpandedRowIntoView(1);
} catch (e) {
  assert(false, `board-dom helpers threw in Node: ${e}`);
}

assert(typeof focusPlayerRow === "function", "focusPlayerRow exported");

if (failed) process.exit(1);
console.log("OK: board-dom");
