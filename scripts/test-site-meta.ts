/**
 * Unit checks for shared site metadata copy.
 * Run: npx tsx scripts/test-site-meta.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  siteDatasetDescription,
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
assert(siteDefaultDescription().includes("2026-27"), "desc season");
assert(siteDefaultDescription("2027-28").includes("2027-28"), "desc override");
assert(siteManifestDescription().includes("VOR rankings"), "manifest");
assert(
  siteDatasetDescription().includes("2026-27"),
  "dataset desc season",
);
assert(
  siteDatasetDescription("2027-28").includes("2027-28"),
  "dataset desc override",
);
assert(
  siteDefaultTitle() === "Fantasy Hockey VOR | 2026-27 ML Rankings",
  "exact default title",
);

const layout = readFileSync(
  join(process.cwd(), "src/app/layout.tsx"),
  "utf8",
);
assert(
  (layout.match(/description: defaultDescription/g) ?? []).length >= 3,
  "OG/Twitter/page share defaultDescription",
);
assert(
  !layout.includes("Stacked-ensemble VOR rankings"),
  "no stale hardcoded social descriptions",
);

if (failed) process.exit(1);
console.log("OK: site-meta");
