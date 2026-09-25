/**
 * Unit checks for site footer copy helpers (French).
 * Run: npx tsx scripts/test-site-footer.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  FOOTER_SOURCE_HREF,
  footerDisclaimerCopy,
  footerSourceLinkAriaLabel,
  footerSourceLinkCopy,
  footerSourcesCopy,
} from "../src/lib/site-footer";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(footerDisclaimerCopy().startsWith("Outil non officiel"), "independence notice");
for (const name of ["LNH", "Fantrax", "Yahoo", "Simon Boisvert"]) {
  assert(footerDisclaimerCopy().includes(name), `notice names ${name}`);
}
assert(footerSourcesCopy().includes("lecture seule"), "Fantrax read-only");
assert(footerSourceLinkCopy() === "Code source (GitHub)", "source label");
assert(footerSourceLinkAriaLabel().includes("nouvel onglet"), "source aria new-tab");
assert(FOOTER_SOURCE_HREF.includes("github.com"), "source href");

const footer = readFileSync(join(process.cwd(), "src/components/site/SiteFooter.tsx"), "utf8");
assert(footer.includes('target="_blank"') && footer.includes('rel="noopener noreferrer"'), "new tab link is safe");
assert(footer.includes("safe-area-inset-bottom"), "footer clears the home indicator");

if (failed) process.exit(1);
console.log("OK: site-footer");
