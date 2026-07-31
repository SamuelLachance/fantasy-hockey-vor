import type { Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";

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
    JSON.stringify(statRanges),
    hideDepthGoalies ? "g1" : "g0",
    sortKey,
    sortDir,
  ].join("|");
}
