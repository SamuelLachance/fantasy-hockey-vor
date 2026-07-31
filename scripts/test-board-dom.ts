/**
 * Unit check: board scroll behavior helper.
 * Run: npx tsx scripts/test-board-dom.ts
 */
import { STICKY_NAME_SHADOW } from "../src/lib/board-dom";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  STICKY_NAME_SHADOW.includes("shadow-"),
  "sticky shadow class present",
);
assert(
  typeof STICKY_NAME_SHADOW === "string" && STICKY_NAME_SHADOW.length > 10,
  "sticky shadow non-empty",
);

if (failed) process.exit(1);
console.log("OK: board-dom");
