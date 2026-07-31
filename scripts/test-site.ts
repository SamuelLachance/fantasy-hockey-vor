/**
 * Unit checks for site URL helpers.
 * Run: npx tsx scripts/test-site.ts
 */
import {
  homeRankingsHref,
  playerDetailsHref,
  SITE_ORIGIN,
  SITE_URL,
} from "../src/lib/site";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(SITE_URL.startsWith(SITE_ORIGIN), "SITE_URL under origin");
assert(SITE_URL.endsWith("/"), "SITE_URL trailing slash");

const prev = process.env.NEXT_PUBLIC_BASE_PATH;
delete process.env.NEXT_PUBLIC_BASE_PATH;
assert(homeRankingsHref() === "/#rankings", "no basePath");
process.env.NEXT_PUBLIC_BASE_PATH = "/fantasy-hockey-vor";
assert(
  homeRankingsHref() === "/fantasy-hockey-vor/#rankings",
  "with basePath",
);
assert(
  playerDetailsHref() === "/fantasy-hockey-vor/player-details.json",
  "details with basePath",
);
delete process.env.NEXT_PUBLIC_BASE_PATH;
assert(playerDetailsHref() === "/player-details.json", "details no basePath");
if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
else process.env.NEXT_PUBLIC_BASE_PATH = prev;

if (failed) process.exit(1);
console.log("OK: site");
