import { formatCount } from "@/lib/format";

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
      Showing {formatCount(Math.min(renderCount, filteredCount))} of{" "}
      {formatCount(filteredCount)} matching players (
      {formatCount(totalCount)} total). Click or Enter/Space a row for category
      breakdown. Click column headers to sort. Press / to focus search, r to
      reset, l to copy link, Home/End to navigate, ? for shortcuts. Esc closes
      help/filters then the open row; j/k or ↑/↓ move (opens first/last if
      none). Shift+G toggles Starters / All goalies.
    </p>
  );
}
