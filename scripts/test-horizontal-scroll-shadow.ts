/**
 * Unit checks for horizontal table scroll shadow threshold.
 * Run: npx tsx scripts/test-horizontal-scroll-shadow.ts
 */
import {
  HORIZONTAL_SCROLL_SHADOW_PX,
  horizontalScrollShadowVisible,
} from "../src/lib/horizontal-scroll-shadow";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(HORIZONTAL_SCROLL_SHADOW_PX === 2, "threshold");
assert(!horizontalScrollShadowVisible(0), "at start");
assert(!horizontalScrollShadowVisible(2), "at threshold");
assert(horizontalScrollShadowVisible(2.1), "past threshold");
assert(horizontalScrollShadowVisible(40), "scrolled");

if (failed) process.exit(1);
console.log("OK: horizontal-scroll-shadow");
