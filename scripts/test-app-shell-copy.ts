/**
 * Unit checks for loading / error / not-found shell copy.
 * Run: npx tsx scripts/test-app-shell-copy.ts
 */
import {
  errorBackToRankingsCopy,
  errorBoundaryBody,
  errorBoundaryTitle,
  errorTryAgainCopy,
  globalErrorBody,
  globalErrorTitle,
  loadingRankingsCopy,
  notFoundBody,
  notFoundTitle,
} from "../src/lib/app-shell-copy";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(loadingRankingsCopy().includes("Loading"), "loading");
assert(errorBoundaryTitle() === "Something went wrong", "error title");
assert(errorBoundaryBody().includes("hard-refresh"), "error body");
assert(errorTryAgainCopy() === "Try again", "try again");
assert(errorBackToRankingsCopy() === "Back to rankings", "back");
assert(notFoundTitle() === "Page not found", "404 title");
assert(notFoundBody().includes("rankings app"), "404 body");
assert(globalErrorTitle() === "App error", "global title");
assert(globalErrorBody().includes("root-level"), "global body");

if (failed) process.exit(1);
console.log("OK: app-shell-copy");
