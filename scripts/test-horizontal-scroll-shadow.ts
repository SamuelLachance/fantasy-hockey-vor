/**
 * Unit checks for horizontal table scroll shadow threshold + DOM attribute.
 * Run: npx tsx scripts/test-horizontal-scroll-shadow.ts
 */
import {
  HORIZONTAL_SCROLL_SCROLLED_ATTR,
  HORIZONTAL_SCROLL_SHADOW_PX,
  applyHorizontalScrollShadow,
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
assert(
  HORIZONTAL_SCROLL_SCROLLED_ATTR === "data-scrolled",
  "scrolled attr name",
);
assert(!horizontalScrollShadowVisible(0), "at start");
assert(!horizontalScrollShadowVisible(2), "at threshold");
assert(horizontalScrollShadowVisible(2.1), "past threshold");
assert(horizontalScrollShadowVisible(40), "scrolled");

const el = {
  scrollLeft: 0,
  attrs: new Set<string>(),
  toggleAttribute(name: string, force?: boolean) {
    if (force) this.attrs.add(name);
    else this.attrs.delete(name);
  },
  hasAttribute(name: string) {
    return this.attrs.has(name);
  },
};

applyHorizontalScrollShadow(el as unknown as HTMLElement);
assert(!el.hasAttribute("data-scrolled"), "attr off at 0");

el.scrollLeft = 10;
applyHorizontalScrollShadow(el as unknown as HTMLElement);
assert(el.hasAttribute("data-scrolled"), "attr on when scrolled");

el.scrollLeft = 0;
applyHorizontalScrollShadow(el as unknown as HTMLElement);
assert(!el.hasAttribute("data-scrolled"), "attr cleared at start");

if (failed) process.exit(1);
console.log("OK: horizontal-scroll-shadow");
