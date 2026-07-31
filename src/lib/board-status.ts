import { formatCount } from "@/lib/format";

/** Sr-only section heading for the rankings board landmark. */
export function rankingsSectionHeadingCopy(): string {
  return "VOR rankings";
}

/** Static tip after the live showing summary (expand + sort affordances). */
export function boardInteractionTipCopy(): string {
  return (
    "Click or Enter/Space a row for category breakdown. Click column headers to sort."
  );
}

/** Visible-row summary for the board status bar (aria-live). */
export function boardShowingSummary(
  renderCount: number,
  filteredCount: number,
  totalCount: number,
  opts?: { searchPending?: boolean },
): string {
  const shown = Math.min(Math.max(0, renderCount), Math.max(0, filteredCount));
  const base = `Showing ${formatCount(shown)} of ${formatCount(Math.max(0, filteredCount))} matching players (${formatCount(Math.max(0, totalCount))} total).`;
  if (opts?.searchPending) return `${base} Updating…`;
  return base;
}
