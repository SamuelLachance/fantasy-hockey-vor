import { formatCount } from "@/lib/format";

/** Rows still hidden behind progressive load. */
export function remainingBoardRows(
  filteredCount: number,
  renderCount: number,
): number {
  return Math.max(0, filteredCount - renderCount);
}

/** Visible load-more control label. */
export function loadMoreLabel(remaining: number): string {
  return `Load more · ${formatCount(remaining)} left`;
}

/** Accessible name for the load-more control (includes m hotkey context via aria-keyshortcuts). */
export function loadMoreAriaLabel(remaining: number): string {
  return `Load more players, ${formatCount(remaining)} remaining`;
}
