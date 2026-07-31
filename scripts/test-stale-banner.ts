/**
 * Unit checks for stale rankings banner copy.
 * Run: npx tsx scripts/test-stale-banner.ts
 */
import {
  staleBannerMessage,
  staleBannerRole,
} from "../src/lib/stale-banner";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(staleBannerRole(false) === "status", "fresh-ish → status");
assert(staleBannerRole(true) === "alert", "very stale → alert");
assert(
  staleBannerMessage(1, false) ===
    "Rankings data is 1 day old — re-run npm run generate after refresh/train for current projections.",
  "singular day",
);
assert(
  staleBannerMessage(12.9, true).includes("12 days old (refresh urgently)"),
  "plural + urgency",
);
assert(
  staleBannerMessage(12.9, true).includes("npm run generate"),
  "mentions generate",
);

if (failed) process.exit(1);
console.log("OK: stale-banner");
