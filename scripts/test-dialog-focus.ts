/**
 * Unit checks for dialog focus-trap helpers.
 * Run: npx tsx scripts/test-dialog-focus.ts
 */
import { trapDialogTabKey } from "../src/lib/dialog-focus";

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

if (failed) process.exit(1);
console.log("OK: dialog-focus");
