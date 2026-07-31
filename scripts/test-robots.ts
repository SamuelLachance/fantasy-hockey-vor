/**
 * Unit checks for robots.txt route config.
 * Run: npx tsx scripts/test-robots.ts
 */
import { readFileSync } from "fs";
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
assert(src.includes("sitemap.xml"), "sitemap present");
assert(
  src.includes("basePath ? `${basePath}/` : \"/\""),
  "allow scoped under basePath",
);

if (failed) process.exit(1);
console.log("OK: robots");
