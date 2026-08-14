import { formatCount } from "@/lib/format";
import { emptyBoardStatusCopy } from "@/lib/board-empty-recovery";

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

/** Visible-row summary for the board status bar. */
export function boardShowingSummary(
  renderCount: number,
  filteredCount: number,
  totalCount: number,
  opts?: { searchPending?: boolean; linkedPlayerName?: string | null },
): string {
  const shown = Math.min(Math.max(0, renderCount), Math.max(0, filteredCount));
  let base = `Showing ${formatCount(shown)} of ${formatCount(Math.max(0, filteredCount))} matching players (${formatCount(Math.max(0, totalCount))} total).`;
  if (opts?.linkedPlayerName) {
    base = `${base} ${emptyBoardStatusCopy(opts.linkedPlayerName)}`;
  }
  if (opts?.searchPending) return `${base} Updating…`;
  return base;
}

/**
 * Polite live copy: matching totals only. Omits the infinite-scroll window so
 * Load more does not re-announce, and stays silent on an empty board (the
 * empty state owns that announcement).
 */
export function boardShowingLiveCopy(
  filteredCount: number,
  totalCount: number,
  opts?: { searchPending?: boolean; linkedPlayerName?: string | null },
): string {
  const filtered = Math.max(0, filteredCount);
  if (filtered === 0) return "";
  let base = `${formatCount(filtered)} matching players (${formatCount(Math.max(0, totalCount))} total).`;
  if (opts?.linkedPlayerName) {
    base = `${base} ${emptyBoardStatusCopy(opts.linkedPlayerName)}`;
  }
  if (opts?.searchPending) return `${base} Updating…`;
  return base;
}
