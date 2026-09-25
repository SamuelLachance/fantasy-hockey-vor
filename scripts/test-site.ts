/**
 * Unit checks for site URL helpers.
 * Run: npx tsx scripts/test-site.ts
 */
import {
  fantraxDataHref,
  SITE_BRAND,
  SITE_ORIGIN,
  SITE_SHORT_NAME,
  SITE_URL,
  withBasePath,
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
const prevBuild = process.env.NEXT_PUBLIC_BUILD_TIME;
delete process.env.NEXT_PUBLIC_BUILD_TIME;

delete process.env.NEXT_PUBLIC_BASE_PATH;
assert(withBasePath("/") === "/", "home without basePath");
assert(withBasePath("/snake") === "/snake", "path without basePath");

process.env.NEXT_PUBLIC_BASE_PATH = "/fantasy-hockey-vor";
assert(withBasePath("/") === "/fantasy-hockey-vor/", "home with basePath keeps its slash");
assert(withBasePath("/ligues/x/y") === "/fantasy-hockey-vor/ligues/x/y", "no trailing slash added");
assert(withBasePath("//double") === "/fantasy-hockey-vor/double", "double slashes folded");

process.env.NEXT_PUBLIC_BUILD_TIME = "2026-07-30T12:00:00.000Z";
assert(
  fantraxDataHref("pool.json") === "/fantasy-hockey-vor/fantrax/pool.json?v=2026-07-30T12%3A00%3A00.000Z",
  "fantrax data href: basePath + cache buster",
);

if (prevBuild === undefined) delete process.env.NEXT_PUBLIC_BUILD_TIME;
else process.env.NEXT_PUBLIC_BUILD_TIME = prevBuild;
if (prev === undefined) delete process.env.NEXT_PUBLIC_BASE_PATH;
else process.env.NEXT_PUBLIC_BASE_PATH = prev;

if (failed) process.exit(1);
console.log("OK: site");
