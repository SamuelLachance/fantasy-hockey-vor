/**
 * Unit checks for dialog focus-trap helpers.
 * Run: npx tsx scripts/test-dialog-focus.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  computedStyleHidesFromTab,
  shouldCloseDialogOnBackdropClick,
  trapDialogTabKey,
} from "../src/lib/dialog-focus";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const focused: string[] = [];
const first = {
  focus() {
    focused.push("first");
  },
} as HTMLElement;
const last = {
  focus() {
    focused.push("last");
  },
} as HTMLElement;
let prevented = false;
const e = {
  key: "Tab",
  shiftKey: false,
  preventDefault() {
    prevented = true;
  },
};

assert(
  trapDialogTabKey(e, [first, last], last) === true,
  "tab past last trapped",
);
assert(prevented, "preventDefault on trap");
assert(focused.at(-1) === "first", "cycles to first");

prevented = false;
e.shiftKey = true;
assert(
  trapDialogTabKey(e, [first, last], first) === true,
  "shift-tab past first trapped",
);
assert(focused.at(-1) === "last", "cycles to last");

prevented = false;
e.shiftKey = false;
focused.length = 0;
const outside = {} as HTMLElement;
assert(
  trapDialogTabKey(e, [first, last], outside) === true,
  "tab from outside pulls into dialog",
);
assert(prevented, "preventDefault when outside");
assert(focused.at(-1) === "first", "outside tab → first");

prevented = false;
e.shiftKey = true;
focused.length = 0;
assert(
  trapDialogTabKey(e, [first, last], outside) === true,
  "shift-tab from outside pulls to last",
);
assert(focused.at(-1) === "last", "outside shift-tab → last");

e.key = "a";
assert(trapDialogTabKey(e, [first, last], first) === false, "non-tab ignored");

const src = readFileSync(
  join(process.cwd(), "src/lib/dialog-focus.ts"),
  "utf8",
);
assert(
  src.includes("[inert], [hidden], [aria-hidden='true']"),
  "skips inert/hidden focusables",
);
assert(src.includes("getComputedStyle"), "skips CSS-hidden focusables");
assert(
  computedStyleHidesFromTab({ display: "none", visibility: "visible" }),
  "display none is off-tab",
);
assert(
  computedStyleHidesFromTab({ display: "block", visibility: "hidden" }),
  "visibility hidden is off-tab",
);
assert(
  computedStyleHidesFromTab({ display: "table-row", visibility: "collapse" }),
  "visibility collapse is off-tab",
);
assert(
  !computedStyleHidesFromTab({ display: "flex", visibility: "visible" }),
  "visible flex stays on-tab",
);

const overlay = { id: "overlay" } as unknown as EventTarget;
const panel = { id: "panel" } as unknown as EventTarget;
assert(
  shouldCloseDialogOnBackdropClick(true, overlay, overlay),
  "backdrop press+click closes",
);
assert(
  !shouldCloseDialogOnBackdropClick(false, overlay, overlay),
  "click without backdrop down stays open",
);
assert(
  !shouldCloseDialogOnBackdropClick(true, panel, overlay),
  "drag from panel onto backdrop stays open",
);

if (failed) process.exit(1);
console.log("OK: dialog-focus");
