/**
 * Unit checks for ScrollToTop visibility hysteresis.
 * Run: npx tsx scripts/test-scroll-to-top.ts
 */
import {
  SCROLL_TOP_HIDE_BELOW,
  SCROLL_TOP_SHOW_AFTER,
  scrollToTopAriaLabel,
  scrollToTopShouldRestoreFocus,
  scrollToTopTitle,
  scrollToTopVisible,
} from "../src/lib/scroll-to-top";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(SCROLL_TOP_SHOW_AFTER > SCROLL_TOP_HIDE_BELOW, "hysteresis gap");
assert(!scrollToTopVisible(0, false), "hidden at top");
assert(!scrollToTopVisible(SCROLL_TOP_SHOW_AFTER, false), "not yet at threshold");
assert(
  scrollToTopVisible(SCROLL_TOP_SHOW_AFTER + 1, false),
  "shows past threshold",
);
assert(
  scrollToTopVisible(SCROLL_TOP_HIDE_BELOW + 1, true),
  "stays while above hide",
);
assert(
  !scrollToTopVisible(SCROLL_TOP_HIDE_BELOW, true),
  "hides at/under hide line",
);
assert(
  scrollToTopAriaLabel() === "Scroll to top and focus search",
  "aria label",
);
assert(
  scrollToTopTitle() === "Scroll to top and focus search",
  "title",
);
assert(
  scrollToTopShouldRestoreFocus(false, true),
  "restore when hidden and focused",
);
assert(
  !scrollToTopShouldRestoreFocus(true, true),
  "no restore while visible",
);
assert(
  !scrollToTopShouldRestoreFocus(false, false),
  "no restore when not focused",
);

if (failed) process.exit(1);
console.log("OK: scroll-to-top");
