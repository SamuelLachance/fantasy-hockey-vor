import type { RangeKey, StatRanges } from "@/lib/rankings-filters";

/** Count non-empty min/max bounds among the keys shown for the current board. */
export function countActiveStatFilters(
  statRanges: StatRanges,
  filterRangeKeys: readonly RangeKey[],
): number {
  let n = 0;
  for (const key of filterRangeKeys) {
    const b = statRanges[key];
    if (b?.min?.trim() || b?.max?.trim()) n++;
  }
  return n;
}
