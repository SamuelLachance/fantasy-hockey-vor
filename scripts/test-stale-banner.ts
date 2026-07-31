/**
 * Unit checks for stale rankings banner copy.
 * Run: npx tsx scripts/test-stale-banner.ts
 */
import {
  staleBannerMessage,
  staleBannerParts,
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
assert(staleBannerParts(1, false).unit === "day", "parts singular");
assert(staleBannerParts(2, false).unit === "days", "parts plural");
assert(
  staleBannerParts(12, true).urgency === " (refresh urgently)",
  "parts urgency",
);
assert(
  staleBannerParts(1, false).command === "npm run generate",
  "parts command",
);

if (failed) process.exit(1);
console.log("OK: stale-banner");
