/**
 * Unit checks for board help button copy.
 * Run: npx tsx scripts/test-board-help-copy.ts
 */
import {
  boardHelpAriaLabel,
  boardHelpTitle,
  boardShortcutsCloseAriaLabel,
} from "../src/lib/board-help-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(boardHelpTitle().includes("(?)"), "title has ?");
assert(boardHelpAriaLabel() === "Keyboard shortcuts", "aria");
assert(
  boardShortcutsCloseAriaLabel() === "Close shortcuts",
  "close aria",
);

if (failed) process.exit(1);
console.log("OK: board-help-copy");
