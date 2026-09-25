/**
 * Every `scripts/test-*.ts` runs in `npm run test:unit`, and every script
 * that list names exists (a test nobody runs guards nothing; a missing one
 * breaks the daily deploy).
 * Run: npx tsx scripts/test-unit-manifest.ts
 */
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";

/** Test scripts deliberately left out of test:unit (none today), with the reason. */
const NOT_RUN: Record<string, string> = {};

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { scripts: Record<string, string> };
const unit = pkg.scripts["test:unit"] ?? "";
const listed = [...unit.matchAll(/tsx (scripts\/[^\s&]+\.ts)/g)].map((m) => m[1]!);
assert(listed.length > 0, "test:unit lists scripts");
assert(new Set(listed).size === listed.length, "no script listed twice");
for (const rel of listed) assert(existsSync(join(process.cwd(), rel)), `${rel} (listed in test:unit) exists`);

const onDisk = readdirSync(join(process.cwd(), "scripts"))
  .filter((f) => /^test-.*\.ts$/.test(f))
  .map((f) => `scripts/${f}`);
for (const rel of onDisk) {
  if (NOT_RUN[rel]) continue;
  assert(listed.includes(rel), `${rel} runs in test:unit`);
}
for (const rel of Object.keys(NOT_RUN)) assert(existsSync(join(process.cwd(), rel)), `allowlisted ${rel} exists`);
assert(listed.includes("scripts/check-ui-contracts.ts"), "UI contracts run with the unit tests");
assert((pkg.scripts["build:pages"] ?? "").includes("scripts/check-export.ts"), "build:pages checks the export");

if (failed) process.exit(1);
console.log(`OK: unit manifest (${listed.length} scripts in test:unit)`);
