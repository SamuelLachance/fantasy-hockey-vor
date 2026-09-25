/**
 * Unit checks for robots.txt route config.
 * Run: npx tsx scripts/test-robots.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const src = readFileSync(join(process.cwd(), "src/app/robots.ts"), "utf8");
assert(!src.includes("host:"), "no invalid Host directive");
assert(src.includes("NEXT_PUBLIC_BASE_PATH"), "scopes allow via basePath");
assert(!/sitemap\s*:/.test(src) && !src.includes("sitemap.xml"), "no sitemap: the site is noindex");
assert(!existsSync(join(process.cwd(), "src/app/sitemap.ts")), "no sitemap route");
assert(src.includes('basePath ? `${basePath}/` : "/"'), "allow scoped under basePath");

if (failed) process.exit(1);
console.log("OK: robots");
