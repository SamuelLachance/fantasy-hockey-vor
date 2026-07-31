/**
 * Unit checks for board document titles.
 * Run: npx tsx scripts/test-board-document-title.ts
 */
import {
  BOARD_TITLE_PLAYER_NAME_MAX,
  boardDocumentTitle,
  boardFiltersTitleToken,
  boardPlayerTitleToken,
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
assert(boardFiltersTitleToken(0) === null, "no filters token");
assert(boardFiltersTitleToken(2) === "2f", "filters token");
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    activeFilterCount: 2,
  }) === "Fantasy Hockey VOR · 2f",
  "title includes filter count",
);
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    showingAllGoalies: true,
  }) === "Fantasy Hockey VOR · All G",
  "title includes All G",
);
assert(
  boardDocumentTitle({
    position: "C",
    query: "",
    sortKey: "draftValue",
    sortDir: "desc",
    activeFilterCount: 1,
    showingAllGoalies: true,
  }) === "Fantasy Hockey VOR · C · Edge · 1f · All G",
  "title combines filters and All G",
);
assert(boardPlayerTitleToken("  ") === null, "blank player omitted");
assert(
  boardPlayerTitleToken("Celebrini") === "Celebrini",
  "short player kept",
);
const longName = "A".repeat(BOARD_TITLE_PLAYER_NAME_MAX + 5);
assert(
  boardPlayerTitleToken(longName)?.endsWith("…") === true,
  "long player truncated",
);
assert(
  boardPlayerTitleToken(longName)?.length === BOARD_TITLE_PLAYER_NAME_MAX,
  "long player max length",
);
assert(
  boardDocumentTitle({
    position: "ALL",
    query: "",
    playerName: longName,
  }).includes("…"),
  "title truncates long player name",
);

if (failed) process.exit(1);
console.log("OK: board-document-title");
