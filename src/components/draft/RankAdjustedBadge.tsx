import type { BoardRankAdjustment } from "@/lib/draft/board-types";
import { rankAdjustmentText } from "@/lib/draft/draft-copy";

/**
 * « ajusté » next to a hand-moved player's rank or VOR (see
 * `rank-adjustments.json`): the reason and the engine's figures in the
 * tooltip, and for screen readers.
 */
export function RankAdjustedBadge({ adjusted, className = "" }: { adjusted: BoardRankAdjustment | undefined; className?: string }) {
  if (!adjusted) return null;
  const text = rankAdjustmentText(adjusted);
  return (
    <span
      title={text}
      className={`inline-flex shrink-0 items-center rounded bg-amber-400/15 px-1 py-px text-[10px] font-semibold leading-4 text-amber-200 ${className}`}
    >
      ajusté<span className="sr-only"> : {text}</span>
    </span>
  );
}
