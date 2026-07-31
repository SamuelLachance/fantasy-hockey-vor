import type { Position } from "@/lib/types";
import type { StatRanges } from "@/lib/rankings-filters";

/** Token that resets the infinite-scroll window when board filters change. */
export function boardFilterResetToken(
  position: Position | "ALL",
  query: string,
  statRanges: StatRanges,
  hideDepthGoalies: boolean,
): string {
  return [
    position,
    query.trim().toLowerCase(),
    JSON.stringify(statRanges),
    hideDepthGoalies ? "g1" : "g0",
  ].join("|");
}
