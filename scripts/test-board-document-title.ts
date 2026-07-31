/**
 * Unit checks for board document titles.
 * Run: npx tsx scripts/test-board-document-title.ts
 */
import { boardDocumentTitle } from "../src/lib/board-document-title";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  boardDocumentTitle({ position: "ALL", query: "" }).includes("2026-27"),
  "default title",
);
assert(
  boardDocumentTitle({ position: "C", query: "" }) ===
    "Fantasy Hockey VOR · C",
  "position only",
);
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    playerName: "Celebrini",
  }) === "Fantasy Hockey VOR · Celebrini",
  "player only",
);
assert(
  boardDocumentTitle({
    position: "C",
    query: "mack",
    playerName: "Mackinnon",
  }) === "Fantasy Hockey VOR · Mackinnon · C · “mack”",
  "combined",
);
const long = boardDocumentTitle({
  position: "ALL",
  query: "abcdefghijklmnopqrstuvwxyz",
});
assert(long.includes("…"), "truncates long query");
assert(!long.includes("abcdefghijklmnopqrstuvwxyz"), "not full long query");

if (failed) process.exit(1);
console.log("OK: board-document-title");
