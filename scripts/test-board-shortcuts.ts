/**
 * Unit checks for board shortcut catalogue.
 * Run: npx tsx scripts/test-board-shortcuts.ts
 */
import {
  BOARD_SHORTCUT_ROWS,
  BOARD_SORT_HOTKEYS,
  boardShortcutsFooterChip,
  boardShortcutsStatusCopy,
} from "../src/lib/board-shortcuts";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  BOARD_SHORTCUT_ROWS.some((r) => r.keys === "m"),
  "m load more documented",
);
assert(boardShortcutsStatusCopy().includes("m load more"), "status mentions m");
assert(
  boardShortcutsFooterChip().includes(" · m · "),
  "footer chip mentions m",
);
assert(BOARD_SORT_HOTKEYS.v === "vor", "v → vor");
assert(BOARD_SORT_HOTKEYS.e === "draftValue", "e → edge");
assert(BOARD_SORT_HOTKEYS.u === "sigma", "u → sigma");
assert(BOARD_SORT_HOTKEYS.g === "gamesPlayed", "g → gp");
assert(boardShortcutsStatusCopy().includes("Shift+G"), "status mentions Shift+G");
assert(boardShortcutsStatusCopy().includes("j/k"), "status mentions j/k");
assert(
  boardShortcutsFooterChip().includes("Shift+G"),
  "footer chip mentions Shift+G",
);

const keys = BOARD_SHORTCUT_ROWS.map((r) => r.keys);
assert(new Set(keys).size === keys.length, "unique shortcut keys");

if (failed) process.exit(1);
console.log("OK: board-shortcuts");
