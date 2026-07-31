import {
  isInvertedRangeBound,
  parseRangeValue,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";

/** Count parseable min/max bounds among the keys shown for the current board. */
export function countActiveStatFilters(
  statRanges: StatRanges,
  filterRangeKeys: readonly RangeKey[],
): number {
  let n = 0;
  for (const key of filterRangeKeys) {
    const b = statRanges[key];
    if (isInvertedRangeBound(key, b?.min, b?.max)) continue;
    if (
      parseRangeValue(key, b?.min ?? "") != null ||
      parseRangeValue(key, b?.max ?? "") != null
    ) {
      n++;
    }
  }
  return n;
}
