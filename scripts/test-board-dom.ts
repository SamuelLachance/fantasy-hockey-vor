/**
 * Unit check: board scroll helpers / sticky shadow constant.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  BOARD_STICKY_CHROME_HEIGHT_VAR,
  BOARD_STICKY_CHROME_SELECTOR,
  BOARD_STICKY_THEAD_SELECTOR,
  BOARD_STICKY_TOP_CLASS,
  STICKY_NAME_SHADOW,
  boardSafeAreaInsetBottom,
  boardSafeAreaInsetTop,
  boardStickyChromeHeight,
  boardStickyTopInset,
  boardVisualViewportFrame,
  focusBoardSearch,
  focusBoardSearchWhenReady,
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
  focusBoardSearch({ preventScroll: true });
  focusBoardSearchWhenReady({ preventScroll: true }, 0);
  focusPlayerRow(1);
  focusPlayerRowIfPanelFocused(1);
  scrollPageTop();
  scrollToRankings();
  scrollToRankings({ focusSearch: true });
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
  typeof focusBoardSearchWhenReady === "function",
  "focusBoardSearchWhenReady exported",
);
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
// The table head is sticky inside the horizontal scroll wrapper, and
// `overflow-x: auto` forces `overflow-y: auto` — so that wrapper, not the
// viewport, is its scrollport, and it never scrolls vertically. A non-zero
// sticky `top` therefore cannot pin the head to anything: it just displaces
// it downward by that offset, painting the header over the first rows
// (measured: the chrome var resolved to 116px, ≈2.5 rows).
assert(BOARD_STICKY_TOP_CLASS === "top-0", "sticky top class is top-0");
assert(
  !BOARD_STICKY_TOP_CLASS.includes("--board-sticky-chrome-height"),
  "sticky top class must not offset by the chrome height",
);
// The variable itself stays — row scroll-mt and scroll-into-view math still
// need it, because the toolbar chrome genuinely is viewport-pinned.
assert(
  boardStickyTopInset(fakeDoc) === 140,
  "chrome height still feeds scroll-into-view insets",
);
assert(typeof boardSafeAreaInsetTop === "function", "safe-area helper");
assert(boardSafeAreaInsetTop(null) === 0, "safe-area null → 0");
assert(
  typeof boardSafeAreaInsetBottom === "function",
  "safe-area bottom helper",
);
assert(boardSafeAreaInsetBottom(null) === 0, "safe-area bottom null → 0");
assert(
  boardVisualViewportFrame(null).height === 0,
  "visualViewport null → empty frame",
);
assert(
  boardVisualViewportFrame({ innerHeight: 800 }).height === 800,
  "falls back to innerHeight",
);
assert(
  boardVisualViewportFrame({
    innerHeight: 800,
    visualViewport: { offsetTop: 40, height: 500 },
  }).offsetTop === 40,
  "uses visualViewport offsetTop",
);
assert(
  boardVisualViewportFrame({
    innerHeight: 800,
    visualViewport: { offsetTop: 40, height: 500 },
  }).height === 500,
  "uses visualViewport height",
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

const boardDomSrc = readFileSync(
  join(process.cwd(), "src/lib/board-dom.ts"),
  "utf8",
);
assert(
  boardDomSrc.includes("focusBoardSearchWhenReady({ preventScroll: true })"),
  "scrollToRankings focusSearch retries with preventScroll",
);
assert(
  boardDomSrc.includes("requestAnimationFrame(tick)"),
  "focusBoardSearchWhenReady retries via rAF",
);

if (failed) process.exit(1);
console.log("OK: board-dom");
