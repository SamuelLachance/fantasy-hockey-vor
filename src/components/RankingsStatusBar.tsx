import {
  boardInteractionTipCopy,
  boardShowingSummary,
} from "@/lib/board-status";
import { boardShortcutsStatusCopy } from "@/lib/board-shortcuts";

interface RankingsStatusBarProps {
  renderCount: number;
  filteredCount: number;
  totalCount: number;
  /** True while live query is ahead of deferred filtering. */
  searchPending?: boolean;
  /** Deep-linked player parked off the filtered board. */
  linkedPlayerName?: string | null;
}

export function RankingsStatusBar({
  renderCount,
  filteredCount,
  totalCount,
  searchPending = false,
  linkedPlayerName = null,
}: RankingsStatusBarProps) {
  return (
    <p className="text-center text-xs text-slate-400">
      <span
        className="tabular-nums"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={searchPending || undefined}
      >
        {boardShowingSummary(renderCount, filteredCount, totalCount, {
          searchPending,
          linkedPlayerName,
        })}
      </span>{" "}
      {boardInteractionTipCopy()} {boardShortcutsStatusCopy()}
    </p>
  );
}
