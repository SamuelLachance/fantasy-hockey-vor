/**
 * Unit check: board scroll helpers / sticky shadow constant.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import {
  BOARD_STICKY_CHROME_HEIGHT_VAR,
  BOARD_STICKY_CHROME_SELECTOR,
  BOARD_STICKY_THEAD_SELECTOR,
  BOARD_STICKY_TOP_CLASS,
  STICKY_NAME_SHADOW,
  boardStickyChromeHeight,
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
  withPinnedWindowScroll,
  stickyAwareScrollDelta,
  syncBoardStickyChromeHeight,
  unionVerticalBounds,
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
assert(boardStickyChromeHeight(null) === 0, "chrome height null → 0");
assert(syncBoardStickyChromeHeight(null) === 0, "sync null → 0");

const fakeDoc = {
  querySelector(sel: string) {
    if (sel === BOARD_STICKY_CHROME_SELECTOR) {
      return {
        getBoundingClientRect: () => ({ height: 100 }),
      } as Element;
    }
    if (sel === BOARD_STICKY_THEAD_SELECTOR) {
      return {
        getBoundingClientRect: () => ({ height: 40 }),
      } as Element;
    }
    return null;
  },
  getElementById() {
    return null;
  },
};
assert(boardStickyChromeHeight(fakeDoc) === 100, "chrome height only");
assert(boardStickyTopInset(fakeDoc) === 140, "inset chrome + thead");
assert(
  BOARD_STICKY_CHROME_HEIGHT_VAR === "--board-sticky-chrome-height",
  "css var name",
);
assert(
  BOARD_STICKY_THEAD_SELECTOR.includes("thead"),
  "thead selector",
);
assert(
  BOARD_STICKY_TOP_CLASS.includes("--board-sticky-chrome-height"),
  "sticky top class uses css var",
);
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
assert(
  unionVerticalBounds({ top: 100, bottom: 140 }, { top: 140, bottom: 400 })
    .bottom === 400,
  "union includes panel bottom",
);
assert(
  unionVerticalBounds({ top: 100, bottom: 140 }, null).top === 100,
  "union without panel",
);

let pinnedWrote = false;
withPinnedWindowScroll(() => {
  pinnedWrote = true;
});
assert(pinnedWrote, "withPinnedWindowScroll invokes write");

if (failed) process.exit(1);
console.log("OK: board-dom");
