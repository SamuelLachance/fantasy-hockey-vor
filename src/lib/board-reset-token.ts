import type { Position } from "@/lib/types";
import {
  parseRangeValue,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";

/** Encode only bounds that actually affect filtering (sorted, stable). */
export function encodeActiveStatRangesToken(statRanges: StatRanges): string {
  const parts: string[] = [];
  for (const key of Object.keys(statRanges).sort() as RangeKey[]) {
    const b = statRanges[key];
    if (!b) continue;
    const minRaw = b.min?.trim() ?? "";
    const maxRaw = b.max?.trim() ?? "";
    const min = minRaw ? parseRangeValue(key, minRaw) : undefined;
    const max = maxRaw ? parseRangeValue(key, maxRaw) : undefined;
    if (min == null && max == null) continue;
    parts.push(`${key}:${min ?? ""}-${max ?? ""}`);
  }
  return parts.join(",");
}

/** Token that resets the infinite-scroll window when board view inputs change. */
export function boardFilterResetToken(
  position: Position | "ALL",
  query: string,
  statRanges: StatRanges,
  hideDepthGoalies: boolean,
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): string {
  return [
    position,
    query.trim().toLowerCase(),
    encodeActiveStatRangesToken(statRanges),
    hideDepthGoalies ? "g1" : "g0",
    sortKey,
    sortDir,
  ].join("|");
}
