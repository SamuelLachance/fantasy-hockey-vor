import type { Position } from "@/lib/types";
import {
  isInvertedRangeBound,
  parseRangeValue,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";

/** Encode only bounds that actually affect filtering (sorted, stable). */
export function encodeActiveStatRangesToken(statRanges: StatRanges): string {
  const parts: string[] = [];
  for (const key of Object.keys(statRanges).sort() as RangeKey[]) {
    const b = statRanges[key];
    if (!b) continue;
    if (isInvertedRangeBound(key, b.min, b.max)) continue;
    const minRaw = b.min?.trim() ?? "";
    const maxRaw = b.max?.trim() ?? "";
    const min = minRaw ? parseRangeValue(key, minRaw) : undefined;
    const max = maxRaw ? parseRangeValue(key, maxRaw) : undefined;
    if (min == null && max == null) continue;
    parts.push(`${key}:${min ?? ""}-${max ?? ""}`);
  }
  return parts.join(",");
}

/** Token that resets the infinite-scroll window when filters change.
 * Sort is omitted so resorting keeps the already-loaded row window.
 */
export function boardFilterResetToken(
  position: Position | "ALL",
  query: string,
  statRanges: StatRanges,
  hideDepthGoalies: boolean,
): string {
  return [
    position,
    query.trim().toLowerCase(),
    encodeActiveStatRangesToken(statRanges),
    hideDepthGoalies ? "g1" : "g0",
  ].join("|");
}
