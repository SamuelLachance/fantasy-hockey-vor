"use client";

import type { RefObject } from "react";
import type { Position } from "@/lib/types";
import { RankingsEmptyState } from "./RankingsEmptyState";

interface RankingsBoardFooterProps {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  filteredCount: number;
  canLoadMore: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onClearSearch: () => void;
  onClearStatFilters: () => void;
  onShowAllPositions: () => void;
  onResetBoard: () => void;
}

/** Empty state and progressive load control inside the board card. */
export function RankingsBoardFooter({
  query,
  activeFilterCount,
  position,
  filteredCount,
  canLoadMore,
  loadMoreRef,
  onLoadMore,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  onResetBoard,
}: RankingsBoardFooterProps) {
  return (
    <>
      {filteredCount === 0 && (
        <RankingsEmptyState
          query={query}
          activeFilterCount={activeFilterCount}
          position={position}
          onClearSearch={onClearSearch}
          onClearStatFilters={onClearStatFilters}
          onShowAllPositions={onShowAllPositions}
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
            className="rounded-lg px-3 py-1.5 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Load more players
          </button>
        </div>
      )}
    </>
  );
}
