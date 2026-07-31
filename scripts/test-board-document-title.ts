/**
 * Unit checks for board document titles.
 * Run: npx tsx scripts/test-board-document-title.ts
 */
import {
  boardDocumentTitle,
  boardSortTitleToken,
} from "../src/lib/board-document-title";

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

assert(boardSortTitleToken("vor", "desc") === null, "default sort omitted");
assert(boardSortTitleToken("vor", "asc") === "VOR↑", "vor asc marked");
assert(boardSortTitleToken("draftValue", "desc") === "Edge", "edge default dir");
assert(boardSortTitleToken("draftValue", "asc") === "Edge↑", "edge asc");
assert(boardSortTitleToken("sigma", "asc") === "Σσ", "sigma default dir");
assert(boardSortTitleToken("sigma", "desc") === "Σσ↓", "sigma desc");
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    sortKey: "draftValue",
    sortDir: "desc",
  }) === "Fantasy Hockey VOR · Edge",
  "title includes sort",
);
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    sortKey: "vor",
    sortDir: "desc",
  }).includes("2026-27"),
  "default sort keeps base title",
);

if (failed) process.exit(1);
console.log("OK: board-document-title");
