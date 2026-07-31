/**
 * Unit checks for header hero copy helpers.
 * Run: npx tsx scripts/test-header-copy.ts
 */
import {
  headerEyebrowCopy,
  headerHeroTitle,
  headerJumpCtaCopy,
  headerJumpCtaTitle,
  headerLeadCopy,
  skipToRankingsCopy,
} from "../src/lib/header-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(headerEyebrowCopy() === "Value Over Replacement", "eyebrow");
assert(headerHeroTitle() === "Fantasy Hockey VOR", "hero brand");
assert(headerJumpCtaCopy() === "Jump to board", "cta");
assert(
  headerJumpCtaTitle() === "Jump to board + focus search",
  "cta title",
);
assert(headerLeadCopy("2026-27").startsWith("2026-27 projections"), "lead");
assert(headerLeadCopy("2026-27").includes("±1σ"), "lead uncertainty");
assert(skipToRankingsCopy() === "Skip to rankings", "skip link");

if (failed) process.exit(1);
console.log("OK: header-copy");
