"use client";

import type { RefObject } from "react";
import type { Position } from "@/lib/types";
import { formatCount } from "@/lib/format";
import { RankingsEmptyState } from "./RankingsEmptyState";

interface RankingsBoardFooterProps {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  filteredCount: number;
  renderCount: number;
  canLoadMore: boolean;
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
  loadMoreRef,
  onLoadMore,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  canShowAllGoalies,
  onShowAllGoalies,
  onResetBoard,
}: RankingsBoardFooterProps) {
  const remaining = Math.max(0, filteredCount - renderCount);

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
            type="button"
            onClick={onLoadMore}
            aria-label={`Load more players, ${formatCount(remaining)} remaining`}
            className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Load more · {formatCount(remaining)} left
          </button>
        </div>
      )}
    </>
  );
}
