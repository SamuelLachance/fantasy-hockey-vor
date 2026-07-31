/**
 * Unit checks for active filter chrome helpers.
 * Run: npx tsx scripts/test-board-active-filter-chips.ts
 */
import {
  boardActiveAllGoaliesChipLabel,
  boardActiveClearPositionAriaLabel,
  boardActiveClearSearchAriaLabel,
  boardActiveEditFiltersTitle,
  boardActiveFiltersRegionLabel,
  boardActiveFiltersVisible,
  boardActivePositionChipLabel,
  boardActiveRemoveStatAriaLabel,
  boardActiveShowStartersAriaLabel,
  boardActiveStatChips,
  formatActiveRangeChip,
} from "../src/lib/board-active-filter-chips";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

assert(
  boardActiveStatChips({ vor: { min: "1", max: "" } }, false).length === 0,
  "hidden when showStatChips false",
);
const chips = boardActiveStatChips(
  { vor: { min: "1", max: "5" }, goals: { min: "", max: "" } },
  true,
);
assert(chips.length === 1, "skips empty bounds");
assert(chips[0]!.key === "vor", "vor chip");
assert(chips[0]!.bounds === "1–5", "bounds label");

assert(
  boardActiveStatChips({ goals: { min: "abc", max: "x" } }, true).length === 0,
  "invalid-only skipped",
);
assert(
  formatActiveRangeChip("goals", "2", "abc") === "≥2",
  "mixed valid+junk keeps parseable side",
);
assert(
  boardActiveStatChips(
    { vor: { min: "1", max: "" }, goals: { min: "abc", max: "" } },
    true,
  ).length === 1,
  "junk sibling does not add chip",
);
assert(
  boardActiveStatChips({ vor: { min: "10", max: "5" } }, true).length === 0,
  "inverted range has no chip",
);

assert(
  !boardActiveFiltersVisible({
    position: "ALL",
    query: "  ",
    hasStatFilters: false,
    chipCount: 0,
    showingAllGoalies: false,
  }),
  "empty chrome hidden",
);
assert(
  boardActiveFiltersVisible({
    position: "C",
    query: "",
    hasStatFilters: false,
    chipCount: 0,
    showingAllGoalies: false,
  }),
  "position shows chrome",
);
assert(
  boardActiveFiltersRegionLabel() === "Active board filters",
  "region label",
);
assert(boardActivePositionChipLabel("C") === "Pos C", "position chip");
assert(
  boardActiveClearPositionAriaLabel() === "Clear position filter",
  "clear position aria",
);
assert(
  boardActiveClearSearchAriaLabel() === "Clear search",
  "clear search aria",
);
assert(boardActiveAllGoaliesChipLabel() === "All goalies", "all goalies chip");
assert(
  boardActiveShowStartersAriaLabel() === "Show starter goalies only",
  "show starters aria",
);
assert(boardActiveEditFiltersTitle() === "Edit filters", "edit title");
assert(
  boardActiveRemoveStatAriaLabel("VOR") === "Remove VOR filter",
  "remove stat aria",
);

if (failed) process.exit(1);
console.log("OK: board-active-filter-chips");
