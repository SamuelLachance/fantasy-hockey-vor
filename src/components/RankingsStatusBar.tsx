import { formatCount } from "@/lib/format";
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
      Showing{" "}
      <span className="tabular-nums">
        {formatCount(Math.min(renderCount, filteredCount))}
      </span>{" "}
      of <span className="tabular-nums">{formatCount(filteredCount)}</span>{" "}
      matching players (
      <span className="tabular-nums">{formatCount(totalCount)}</span> total).
      Click or Enter/Space a row for category breakdown. Click column headers to
      sort. {boardShortcutsStatusCopy()}
    </p>
  );
}
