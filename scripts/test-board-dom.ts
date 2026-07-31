/**
 * Unit check: board scroll helpers / sticky shadow constant.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import {
  BOARD_STICKY_CHROME_SELECTOR,
  STICKY_NAME_SHADOW,
  boardStickyTopInset,
  focusBoardSearch,
  focusPlayerRow,
  focusPlayerRowIfPanelFocused,
  focusFirstStatFilterInput,
  focusStatsFilterButton,
  prefersReducedMotion,
  scrollExpandedRowIntoView,
  scrollPageTop,
  scrollToRankings,
  stickyAwareScrollDelta,
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
  focusFirstStatFilterInput();
  focusBoardSearch();
  focusPlayerRow(1);
  focusPlayerRowIfPanelFocused(1);
  scrollPageTop();
  scrollToRankings();
  scrollExpandedRowIntoView(1);
} catch (e) {
  assert(false, `board-dom helpers threw in Node: ${e}`);
}

assert(typeof focusPlayerRow === "function", "focusPlayerRow exported");
assert(
  typeof focusPlayerRowIfPanelFocused === "function",
  "focusPlayerRowIfPanelFocused exported",
);
assert(
  typeof focusFirstStatFilterInput === "function",
  "focusFirstStatFilterInput exported",
);
assert(typeof focusBoardSearch === "function", "focusBoardSearch exported");
assert(
  BOARD_STICKY_CHROME_SELECTOR.includes("data-board-sticky-chrome"),
  "sticky chrome selector",
);
assert(boardStickyTopInset(null) === 0, "sticky inset null doc → 0");
assert(
  stickyAwareScrollDelta(50, 90, 120, 700) === 50 - 128,
  "scroll up out from under sticky chrome",
);
assert(
  stickyAwareScrollDelta(200, 240, 120, 700) === 0,
  "already in visible band → 0",
);
assert(
  stickyAwareScrollDelta(650, 710, 120, 700) === 710 - 692,
  "scroll down when clipped at viewport bottom",
);
assert(
  stickyAwareScrollDelta(200, 900, 120, 700) === 200 - 128,
  "tall row pins top under sticky",
);

if (failed) process.exit(1);
console.log("OK: board-dom");
