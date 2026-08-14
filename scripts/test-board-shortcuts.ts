/**
 * Unit checks for board shortcut catalogue.
 * Run: npx tsx scripts/test-board-shortcuts.ts
 */
import {
  BOARD_SHORTCUT_ROWS,
  BOARD_SHORTCUTS_DIALOG_ID,
  BOARD_SORT_HOTKEYS,
  boardShortcutsFaqAnswer,
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
  BOARD_SHORTCUT_ROWS.some((r) => r.keys === "[ / ]"),
  "[/] position cycle documented",
);
assert(
  boardShortcutsStatusCopy().includes("[ / ] positions"),
  "status mentions position cycle",
);
assert(
  boardShortcutsFooterChip().includes("[/]"),
  "footer chip mentions [/]",
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
assert(
  boardShortcutsFaqAnswer().includes("Esc clears search"),
  "FAQ mentions Esc",
);
assert(
  boardShortcutsFaqAnswer().includes("p copy player link (expanded or linked)"),
  "FAQ mentions p player link",
);
assert(
  boardShortcutsFaqAnswer().includes("Enter/Space expand"),
  "FAQ mentions expand",
);
assert(
  BOARD_SHORTCUT_ROWS.some((r) => r.keys === "p"),
  "p in catalogue",
);
assert(
  BOARD_SHORTCUT_ROWS.some((r) => r.keys === "PgDn / PgUp"),
  "page jump in catalogue",
);
assert(boardShortcutsFooterChip().includes("PgUp/PgDn"), "footer has page jump");
assert(boardShortcutsStatusCopy().includes("PageUp/PageDown"), "status page jump");
assert(boardShortcutsFooterChip().includes("· p ·"), "footer chip has p");

const keys = BOARD_SHORTCUT_ROWS.map((r) => r.keys);
assert(new Set(keys).size === keys.length, "unique shortcut keys");
assert(
  BOARD_SHORTCUTS_DIALOG_ID === "board-shortcuts-dialog",
  "dialog id stable",
);

if (failed) process.exit(1);
console.log("OK: board-shortcuts");
