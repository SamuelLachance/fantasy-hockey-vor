/**
 * Unit checks for expand category bar geometry.
 * Run: npx tsx scripts/test-category-z-bar.ts
 */
import {
  categoryProjectionPrefix,
  categorySigmaDigits,
  categoryZBarWidth,
  categoryZMeterAriaLabel,
  categoryZMeterValue,
  categoryZScoreLabel,
} from "../src/lib/category-z-bar";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(categoryZBarWidth(0) === 50, "z0 → 50");
assert(categoryZBarWidth(5) === 100, "clamped high");
assert(categoryZBarWidth(-10) === 8, "clamped low");
assert(categoryZBarWidth(1) === 62, "z1 → 62");
assert(categorySigmaDigits("goals") === 1, "goals digits");
assert(categorySigmaDigits("hits") === 0, "hits digits");
assert(categoryZMeterValue(0) === 0, "meter 0");
assert(categoryZMeterValue(9) === 4, "meter clamp high");
assert(categoryZMeterValue(-9) === -4, "meter clamp low");
assert(categoryZMeterValue(Number.NaN) === 0, "meter nan");
assert(categoryZScoreLabel(1.5) === "+1.50 z", "z label");
assert(
  categoryZMeterAriaLabel("Goals") === "Goals category z-score",
  "meter aria",
);
assert(categoryProjectionPrefix() === "Proj:", "proj prefix");

if (failed) process.exit(1);
console.log("OK: category-z-bar");
