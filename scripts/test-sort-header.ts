/**
 * Unit checks for sortable column aria helpers.
 * Run: npx tsx scripts/test-sort-header.ts
 */
import {
  sortHeaderAriaLabel,
  sortHeaderAriaSort,
  sortHeaderResetTitle,
} from "../src/lib/sort-header";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(sortHeaderAriaSort("vor", "name", "asc") === "none", "inactive none");
assert(
  sortHeaderAriaSort("vor", "vor", "desc") === "descending",
  "active desc",
);
assert(sortHeaderAriaSort("vor", "vor", "asc") === "ascending", "active asc");
assert(
  sortHeaderAriaLabel("VOR", "vor", "name", "asc") === "Sort by VOR",
  "inactive label",
);
assert(
  sortHeaderAriaLabel("VOR", "vor", "vor", "desc") ===
    "VOR, sorted descending",
  "active label",
);
assert(
  sortHeaderResetTitle() === "Double-click to reset sort to VOR",
  "reset title",
);

if (failed) process.exit(1);
console.log("OK: sort-header");
