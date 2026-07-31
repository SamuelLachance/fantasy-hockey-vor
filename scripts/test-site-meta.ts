/**
 * Unit checks for shared site metadata copy.
 * Run: npx tsx scripts/test-site-meta.ts
 */
import {
  siteDefaultDescription,
  siteDefaultTitle,
  siteManifestDescription,
} from "../src/lib/site-meta";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(siteDefaultTitle().includes("2026-27"), "title season");
assert(siteDefaultTitle("2027-28").includes("2027-28"), "title override");
assert(siteDefaultDescription().includes("Value Over Replacement"), "desc");
assert(siteManifestDescription().includes("VOR rankings"), "manifest");
assert(
  siteDefaultTitle() === "Fantasy Hockey VOR | 2026-27 ML Rankings",
  "exact default title",
);

if (failed) process.exit(1);
console.log("OK: site-meta");
