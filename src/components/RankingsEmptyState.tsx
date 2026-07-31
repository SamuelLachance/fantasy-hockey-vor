"use client";

import type { Position } from "@/lib/types";

interface RankingsEmptyStateProps {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  onClearSearch: () => void;
  onClearStatFilters: () => void;
  onShowAllPositions: () => void;
  onResetBoard: () => void;
}

export function RankingsEmptyState({
  query,
  activeFilterCount,
  position,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  onResetBoard,
}: RankingsEmptyStateProps) {
  return (
    <div
      className="px-6 py-16 text-center text-slate-400"
      role="status"
    >
      <p>No players match your filters.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {query.trim() !== "" && (
          <button
            type="button"
            onClick={onClearSearch}
            className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Clear search
          </button>
        )}
        {activeFilterCount > 0 && (
          <button
            type="button"
            onClick={onClearStatFilters}
            className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Clear stat filters
          </button>
        )}
        {position !== "ALL" && (
          <button
            type="button"
            onClick={onShowAllPositions}
            className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Show all positions
          </button>
        )}
        <button
          type="button"
          onClick={onResetBoard}
          className="rounded-full bg-cyan-500/15 px-4 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          Reset board view
        </button>
      </div>
    </div>
  );
}
