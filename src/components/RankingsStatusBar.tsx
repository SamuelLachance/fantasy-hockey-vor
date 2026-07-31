import { boardShowingSummary } from "@/lib/board-status";
import { boardShortcutsStatusCopy } from "@/lib/board-shortcuts";

interface RankingsStatusBarProps {
  renderCount: number;
  filteredCount: number;
  totalCount: number;
}

export function RankingsStatusBar({
  renderCount,
  filteredCount,
  totalCount,
}: RankingsStatusBarProps) {
  return (
    <p
      className="text-center text-xs text-slate-500"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="tabular-nums">
        {boardShowingSummary(renderCount, filteredCount, totalCount)}
      </span>{" "}
      Click or Enter/Space a row for category breakdown. Click column headers to
      sort. {boardShortcutsStatusCopy()}
    </p>
  );
}
