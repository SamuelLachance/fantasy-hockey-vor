/**
 * Unit checks for site footer helpers.
 * Run: npx tsx scripts/test-site-footer.ts
 */
import {
  FOOTER_SOURCE_HREF,
  footerDraftableCopy,
} from "../src/lib/site-footer";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(footerDraftableCopy(1311) === "1,311 draftable", "draftable count");
assert(FOOTER_SOURCE_HREF.includes("github.com"), "source href");

if (failed) process.exit(1);
console.log("OK: site-footer");
