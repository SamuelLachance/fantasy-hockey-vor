/**
 * Smoke checks for useTimedFlash module presence / export shape.
 * Run: npx tsx scripts/test-timed-flash.ts
 */
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(
  join(process.cwd(), "src/hooks/useTimedFlash.ts"),
  "utf8",
);

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(src.includes("export function useTimedFlash"), "exports hook");
assert(src.includes("clearTimeout"), "clears timer");
assert(src.includes("holdMs"), "configurable hold");
assert(src.includes("setValue(idle)"), "resets to idle");

if (failed) process.exit(1);
console.log("OK: timed-flash");
