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

const first = { focus() {} } as HTMLElement;
const last = { focus() {} } as HTMLElement;
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

prevented = false;
e.shiftKey = true;
assert(
  trapDialogTabKey(e, [first, last], first) === true,
  "shift-tab past first trapped",
);

e.key = "a";
assert(trapDialogTabKey(e, [first, last], first) === false, "non-tab ignored");

if (failed) process.exit(1);
console.log("OK: dialog-focus");
