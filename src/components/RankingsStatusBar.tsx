import { boardShowingSummary } from "@/lib/board-status";
import { boardShortcutsStatusCopy } from "@/lib/board-shortcuts";

interface RankingsStatusBarProps {
  renderCount: number;
  filteredCount: number;
  totalCount: number;
  /** True while live query is ahead of deferred filtering. */
  searchPending?: boolean;
}

export function RankingsStatusBar({
  renderCount,
  filteredCount,
  totalCount,
  searchPending = false,
}: RankingsStatusBarProps) {
  return (
    <p className="text-center text-xs text-slate-400">
      <span
        className={`tabular-nums${searchPending ? " opacity-70" : ""}`}
        aria-live="polite"
        aria-atomic="true"
        aria-busy={searchPending || undefined}
      >
        {boardShowingSummary(renderCount, filteredCount, totalCount, {
          searchPending,
        })}
      </span>{" "}
      Click or Enter/Space a row for category breakdown. Click column headers to
      sort. {boardShortcutsStatusCopy()}
    </p>
  );
}
