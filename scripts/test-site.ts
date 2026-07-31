/**
 * Unit checks for site URL helpers.
 * Run: npx tsx scripts/test-site.ts
 */
import {
  homeRankingsHref,
  playerDetailsHref,
  SITE_BRAND,
  SITE_ORIGIN,
  SITE_SHORT_NAME,
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
assert(SITE_BRAND === "Fantasy Hockey VOR", "brand");
assert(SITE_SHORT_NAME === "VOR Hockey", "short name");

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

const prevBuild = process.env.NEXT_PUBLIC_BUILD_TIME;
process.env.NEXT_PUBLIC_BUILD_TIME = "2026-07-30T12:00:00.000Z";
assert(
  playerDetailsHref() ===
    "/player-details.json?v=2026-07-30T12%3A00%3A00.000Z",
  "details cache buster",
);
process.env.NEXT_PUBLIC_BASE_PATH = "/fantasy-hockey-vor";
assert(
  playerDetailsHref().startsWith("/fantasy-hockey-vor/player-details.json?v="),
  "details basePath + buster",
);
delete process.env.NEXT_PUBLIC_BASE_PATH;
if (prevBuild === undefined) delete process.env.NEXT_PUBLIC_BUILD_TIME;
else process.env.NEXT_PUBLIC_BUILD_TIME = prevBuild;

if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
else process.env.NEXT_PUBLIC_BASE_PATH = prev;

if (failed) process.exit(1);
console.log("OK: site");
