/**
 * Unit checks for board j/k expansion navigation + shortcut target helpers.
 * Run: npx tsx scripts/test-board-keyboard.ts
 */
import {
  BOARD_PAGE_JUMP,
  boardHomeEndPlayerId,
  boardKeyboardNavIds,
  isBoardChromeTarget,
  isBoardImeComposing,
  isBoardRowNavTarget,
  isBoardRowToggleKey,
  isBoardTypingTarget,
  nextBoardEscapeAction,
  nextBoardEscapeTypingAction,
  nextExpandedPlayerId,
  nextExpandedPlayerIdByStep,
  shouldIgnoreBoardShortcut,
  shouldPrefetchBoardPage,
} from "../src/lib/board-keyboard";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const ids = [10, 20, 30];

assert(nextExpandedPlayerId([], null, 1) === null, "empty list");
assert(nextExpandedPlayerId(ids, null, 1) === 10, "j opens first");
assert(nextExpandedPlayerId(ids, null, -1) === 30, "k opens last");
assert(nextExpandedPlayerId(ids, 10, 1) === 20, "j next");
assert(nextExpandedPlayerId(ids, 20, -1) === 10, "k prev");
assert(nextExpandedPlayerId(ids, 10, -1) === 10, "k at first stays");
assert(nextExpandedPlayerId(ids, 30, 1) === 30, "j at last stays");
assert(nextExpandedPlayerId(ids, 999, 1) === 10, "missing id → first");
assert(nextExpandedPlayerId(ids, 999, -1) === 30, "missing id → last");
assert(BOARD_PAGE_JUMP === 10, "page jump size");
assert(
  nextExpandedPlayerIdByStep([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 1, 1, 10) ===
    11,
  "PageDown jumps 10",
);
assert(
  nextExpandedPlayerIdByStep([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 11, -1, 10) ===
    1,
  "PageUp jumps 10",
);
assert(
  nextExpandedPlayerIdByStep(ids, 10, 1, 10) === 30,
  "PageDown clamps to last",
);
assert(
  shouldPrefetchBoardPage(95, 100, 500) === true,
  "prefetch near visible end",
);
assert(
  shouldPrefetchBoardPage(50, 100, 500) === false,
  "no prefetch mid-window",
);
assert(
  shouldPrefetchBoardPage(99, 100, 100) === false,
  "no prefetch when fully loaded",
);
assert(boardHomeEndPlayerId(ids, "Home") === 10, "Home → first");
assert(boardHomeEndPlayerId(ids, "End") === 30, "End → last");
assert(boardHomeEndPlayerId([], "Home") === null, "Home empty");
assert(
  isBoardRowNavTarget({
    tagName: "TR",
    closest(sel: string) {
      return sel.includes("player-row") ? ({} as Element) : null;
    },
  } as unknown as EventTarget),
  "row is row-nav target",
);
assert(
  !isBoardRowNavTarget({
    tagName: "BUTTON",
    closest() {
      return null;
    },
  } as unknown as EventTarget),
  "chrome button not row-nav",
);
assert(isBoardRowToggleKey("Enter"), "Enter toggles");
assert(isBoardRowToggleKey(" "), "Space toggles");
assert(!isBoardRowToggleKey("a"), "letter no toggle");

const allIds = [1, 2, 3, 4, 5];
assert(
  boardKeyboardNavIds(allIds, 2, null).join() === "1,2",
  "cold-start nav stays visible",
);
assert(
  boardKeyboardNavIds(allIds, 2, 2).join() === "1,2,3,4,5",
  "expanded nav uses full list",
);
assert(
  nextExpandedPlayerId(boardKeyboardNavIds(allIds, 2, null), null, -1) === 2,
  "cold-start k opens last visible not last filtered",
);
assert(
  boardHomeEndPlayerId(allIds, "End") === 5,
  "Home/End helper on full list reaches last filtered",
);
assert(
  boardHomeEndPlayerId(boardKeyboardNavIds(allIds, 2, null), "End") === 2,
  "Home/End on mounted window would stop early",
);

assert(!isBoardTypingTarget(null), "null not typing");
assert(!isBoardChromeTarget(null), "null not chrome");
assert(shouldIgnoreBoardShortcut(true, null), "help blocks shortcuts");
assert(!shouldIgnoreBoardShortcut(false, null), "no help + null ok");

const input = {
  tagName: "INPUT",
  isContentEditable: false,
  closest: () => null,
};
assert(isBoardTypingTarget(input as unknown as EventTarget), "input typing");
assert(isBoardChromeTarget(input as unknown as EventTarget), "input chrome");

const button = {
  tagName: "BUTTON",
  isContentEditable: false,
  closest(sel: string) {
    return sel.includes("button") ? (this as unknown as Element) : null;
  },
};
assert(!isBoardTypingTarget(button as unknown as EventTarget), "btn not typing");
assert(isBoardChromeTarget(button as unknown as EventTarget), "btn chrome");
assert(
  shouldIgnoreBoardShortcut(false, button as unknown as EventTarget),
  "btn ignored",
);

const row = {
  tagName: "TR",
  isContentEditable: false,
  closest(sel: string) {
    return sel.includes("player-row") ? (this as unknown as Element) : null;
  },
};
assert(!isBoardChromeTarget(row as unknown as EventTarget), "row not chrome");
assert(
  !shouldIgnoreBoardShortcut(false, row as unknown as EventTarget),
  "row allows shortcuts",
);

const panelBtn = {
  tagName: "BUTTON",
  isContentEditable: false,
  closest(sel: string) {
    if (sel.includes("player-panel")) return this as unknown as Element;
    if (sel.includes("player-row")) return null;
    return sel.includes("button") ? (this as unknown as Element) : null;
  },
};
assert(
  !isBoardChromeTarget(panelBtn as unknown as EventTarget),
  "expand panel not chrome",
);
assert(
  !shouldIgnoreBoardShortcut(false, panelBtn as unknown as EventTarget),
  "expand panel allows shortcuts",
);

assert(
  nextBoardEscapeTypingAction({
    tagName: "INPUT",
    type: "search",
    value: "mcd",
  } as unknown as EventTarget).type === "clear-search",
  "Esc clears non-empty search",
);
assert(
  nextBoardEscapeTypingAction({
    tagName: "INPUT",
    type: "search",
    value: "",
  } as unknown as EventTarget).type === "dismiss-row",
  "Esc on empty search dismisses row",
);
assert(
  nextBoardEscapeTypingAction({
    tagName: "TEXTAREA",
    value: "",
  } as unknown as EventTarget).type === "noop-typing",
  "Esc in textarea stays typing",
);

assert(
  nextBoardEscapeAction({
    helpOpen: false,
    filtersOpen: false,
    hasQuery: true,
    typing: false,
    target: null,
    expandedId: 10,
  }).type === "clear-search",
  "Esc off-search clears query before collapse",
);
assert(
  nextBoardEscapeAction({
    helpOpen: false,
    filtersOpen: false,
    hasQuery: false,
    typing: false,
    target: null,
    expandedId: 10,
  }).type === "dismiss-row",
  "Esc off-search collapses when no query",
);
assert(
  nextBoardEscapeAction({
    helpOpen: true,
    filtersOpen: true,
    hasQuery: true,
    typing: false,
    target: null,
    expandedId: 10,
  }).type === "close-help",
  "Esc closes help first",
);

assert(!isBoardImeComposing({ key: "Escape" }), "normal Esc not composing");
assert(
  isBoardImeComposing({ key: "Escape", isComposing: true }),
  "isComposing blocks",
);
assert(isBoardImeComposing({ key: "Process" }), "Process key blocks");

if (failed) process.exit(1);
console.log("OK: board-keyboard");
