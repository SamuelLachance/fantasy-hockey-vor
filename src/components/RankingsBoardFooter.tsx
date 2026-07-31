"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Position } from "@/lib/types";
import { focusPlayerRow } from "@/lib/board-dom";
import {
  loadMoreAriaLabel,
  loadMoreLabel,
  loadMoreTitle,
  remainingBoardRows,
} from "@/lib/board-remaining";
import { RankingsEmptyState } from "./RankingsEmptyState";

interface RankingsBoardFooterProps {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  filteredCount: number;
  renderCount: number;
  canLoadMore: boolean;
  /** Last mounted player — focus target when Load more unmounts after the final page. */
  lastVisiblePlayerId: number | null;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onClearSearch: () => void;
  onClearStatFilters: () => void;
  onShowAllPositions: () => void;
  canShowAllGoalies: boolean;
  onShowAllGoalies: () => void;
  onResetBoard: () => void;
}

/** Empty state and progressive load control inside the board card. */
export function RankingsBoardFooter({
  query,
  activeFilterCount,
  position,
  filteredCount,
  renderCount,
  canLoadMore,
  lastVisiblePlayerId,
  loadMoreRef,
  onLoadMore,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  canShowAllGoalies,
  onShowAllGoalies,
  onResetBoard,
}: RankingsBoardFooterProps) {
  const remaining = remainingBoardRows(filteredCount, renderCount);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef(false);
  const wasCanLoadMoreRef = useRef(canLoadMore);

  useEffect(() => {
    if (
      wasCanLoadMoreRef.current &&
      !canLoadMore &&
      restoreFocusRef.current &&
      lastVisiblePlayerId != null
    ) {
      restoreFocusRef.current = false;
      focusPlayerRow(lastVisiblePlayerId);
    }
    wasCanLoadMoreRef.current = canLoadMore;
  }, [canLoadMore, lastVisiblePlayerId]);

  return (
    <>
      {filteredCount === 0 && (
        <RankingsEmptyState
          query={query}
          activeFilterCount={activeFilterCount}
          position={position}
          canShowAllGoalies={canShowAllGoalies}
          onClearSearch={onClearSearch}
          onClearStatFilters={onClearStatFilters}
          onShowAllPositions={onShowAllPositions}
          onShowAllGoalies={onShowAllGoalies}
          onResetBoard={onResetBoard}
        />
      )}
      {canLoadMore && (
        <div
          ref={loadMoreRef}
          className="border-t border-white/5 px-6 py-4 text-center"
        >
          <button
            ref={buttonRef}
            type="button"
            onClick={() => {
              restoreFocusRef.current =
                document.activeElement === buttonRef.current;
              onLoadMore();
            }}
            aria-keyshortcuts="m"
            title={loadMoreTitle()}
            aria-label={loadMoreAriaLabel(remaining)}
            className="inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-lg px-3 py-2 text-xs tabular-nums text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            {loadMoreLabel(remaining)}
          </button>
        </div>
      )}
    </>
  );
}
