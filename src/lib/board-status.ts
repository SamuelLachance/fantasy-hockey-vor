import { formatCount } from "@/lib/format";

/** Visible-row summary for the board status bar (aria-live). */
export function boardShowingSummary(
  renderCount: number,
  filteredCount: number,
  totalCount: number,
): string {
  const shown = Math.min(Math.max(0, renderCount), Math.max(0, filteredCount));
  return `Showing ${formatCount(shown)} of ${formatCount(Math.max(0, filteredCount))} matching players (${formatCount(Math.max(0, totalCount))} total).`;
}
