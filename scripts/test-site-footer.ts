/**
 * Unit checks for site footer copy helpers.
 * Run: npx tsx scripts/test-site-footer.ts
 */
import {
  FOOTER_SOURCE_HREF,
  footerDraftableCopy,
  footerGeneratedPrefixCopy,
  footerNhlApiCopy,
  footerSourceLinkAriaLabel,
  footerSourceLinkCopy,
  footerSourceLinkTitle,
} from "../src/lib/site-footer";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(footerDraftableCopy(1311) === "1,311 draftable", "draftable count");
assert(
  footerGeneratedPrefixCopy() === "Projections generated",
  "generated prefix",
);
assert(footerNhlApiCopy() === "NHL API", "nhl api chip");
assert(footerSourceLinkCopy() === "GitHub", "source label");
assert(
  footerSourceLinkTitle() === "View source on GitHub",
  "source title",
);
assert(
  footerSourceLinkAriaLabel() ===
    "View source on GitHub (opens in a new tab)",
  "source aria new-tab",
);
assert(FOOTER_SOURCE_HREF.includes("github.com"), "source href");

if (failed) process.exit(1);
console.log("OK: site-footer");
