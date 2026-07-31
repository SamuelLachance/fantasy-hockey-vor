import assert from "node:assert/strict";
import {
  defaultSortDir,
  formatRangeChip,
  isInvertedRangeBound,
  normalizeRangeInput,
  parseRangeValue,
  passesRanges,
  rangeLabel,
  vorForFilter,
} from "../src/lib/rankings-filters";
import type { PlayerProjection } from "../src/lib/types";

assert.equal(parseRangeValue("savePct", "91.2"), 0.912);
assert.equal(parseRangeValue("savePct", "0.912"), 0.912);
assert.equal(parseRangeValue("savePct", "91.2%"), 0.912);
assert.equal(parseRangeValue("savePct", "91,2"), 0.912);
assert.equal(normalizeRangeInput(" 91.2% "), "91.2");
assert.equal(normalizeRangeInput("%"), "");
assert.equal(normalizeRangeInput(","), "");
assert.equal(normalizeRangeInput("1,23"), "1.23");
assert.equal(normalizeRangeInput(" 2 , 5 "), "2.5");
assert.equal(parseRangeValue("goals", "40"), 40);
assert.equal(parseRangeValue("goals", ""), undefined);
assert.equal(isInvertedRangeBound("vor", "10", "5"), true);
assert.equal(isInvertedRangeBound("vor", "5", "10"), false);
assert.equal(isInvertedRangeBound("vor", "10", ""), false);
assert.equal(isInvertedRangeBound("vor", "", "5"), false);

assert.equal(defaultSortDir("rank"), "asc");
assert.equal(defaultSortDir("vor"), "desc");
assert.equal(defaultSortDir("sigma"), "asc");
assert.equal(rangeLabel("draftValue"), "Edge vs consensus");
assert.equal(rangeLabel("sigma"), "Uncertainty Σσ");
assert.equal(formatRangeChip("2", ""), "≥2");
assert.equal(formatRangeChip("", "50"), "≤50");
assert.equal(formatRangeChip("1", "10"), "1–10");
assert.equal(formatRangeChip("", ""), "");
assert.equal(formatRangeChip("  2  ", "  "), "≥2");
assert.equal(formatRangeChip("  ", " 40 "), "≤40");
assert.equal(formatRangeChip("91.2%", ""), "≥91.2");
assert.equal(formatRangeChip("%", ","), "");

const player = {
  vor: 5,
  vorByPosition: { C: 4, LW: 6 },
  gamesPlayed: 82,
  draftValue: 3,
  position: "C",
  isGoalie: false,
  projection: { goals: 30, savePct: 0.9 },
  uncertainty: { total: { sigma: 2.5 } },
} as unknown as PlayerProjection;

assert.equal(vorForFilter(player, "ALL"), 5);
assert.equal(vorForFilter(player, "LW"), 6);

assert.equal(
  passesRanges(
    player,
    { goals: { min: "20", max: "40" } },
    "ALL",
    ["goals"],
  ),
  true,
);
assert.equal(
  passesRanges(
    player,
    { goals: { min: "50", max: "" } },
    "ALL",
    ["goals"],
  ),
  false,
);
assert.equal(
  passesRanges(
    player,
    { sigma: { min: "", max: "3" } },
    "ALL",
    ["sigma"],
  ),
  true,
);
assert.equal(
  passesRanges(
    player,
    { sigma: { min: "", max: "2" } },
    "ALL",
    ["sigma"],
  ),
  false,
);
assert.equal(
  passesRanges(
    player,
    { vor: { min: "10", max: "5" } },
    "ALL",
    ["vor"],
  ),
  true,
  "inverted range is ignored",
);

console.log("test-rankings-filters: ok");
