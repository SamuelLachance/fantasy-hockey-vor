/**
 * Unit checks for board j/k expansion navigation + shortcut target helpers.
 * Run: npx tsx scripts/test-board-keyboard.ts
 */
import {
  isBoardChromeTarget,
  isBoardRowToggleKey,
  isBoardTypingTarget,
  nextExpandedPlayerId,
  shouldIgnoreBoardShortcut,
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
assert(isBoardRowToggleKey("Enter"), "Enter toggles");
assert(isBoardRowToggleKey(" "), "Space toggles");
assert(!isBoardRowToggleKey("a"), "letter no toggle");

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

if (failed) process.exit(1);
console.log("OK: board-keyboard");
