"use client";

import type { Position } from "@/lib/types";

interface RankingsEmptyStateProps {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  /** Starters mode on G/ALL — offer expanding to All G as a recovery path. */
  canShowAllGoalies: boolean;
  onClearSearch: () => void;
  onClearStatFilters: () => void;
  onShowAllPositions: () => void;
  onShowAllGoalies: () => void;
  onResetBoard: () => void;
}

function EmptyAction({
  label,
  onClick,
  primary = false,
  keyshortcuts,
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
  keyshortcuts?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-keyshortcuts={keyshortcuts}
      className={
        primary
          ? "rounded-full bg-cyan-500/15 px-4 py-1.5 text-sm font-medium text-cyan-200 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          : "rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      }
    >
      {label}
    </button>
  );
}

export function RankingsEmptyState({
  query,
  activeFilterCount,
  position,
  canShowAllGoalies,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  onShowAllGoalies,
  onResetBoard,
}: RankingsEmptyStateProps) {
  return (
    <div className="px-6 py-16 text-center text-slate-400" role="status">
      <p>No players match your filters.</p>
      <p className="mt-1 text-xs text-slate-500">
        Press r to reset the board, or Esc after clearing search.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {query.trim() !== "" && (
          <EmptyAction label="Clear search" onClick={onClearSearch} />
        )}
        {activeFilterCount > 0 && (
          <EmptyAction
            label="Clear stat filters"
            onClick={onClearStatFilters}
          />
        )}
        {position !== "ALL" && (
          <EmptyAction
            label="Show all positions"
            onClick={onShowAllPositions}
          />
        )}
        {canShowAllGoalies && (
          <EmptyAction
            label="Include depth goalies"
            onClick={onShowAllGoalies}
            keyshortcuts="Shift+G"
          />
        )}
        <EmptyAction
          label="Reset board view"
          onClick={onResetBoard}
          primary
          keyshortcuts="r"
        />
      </div>
    </div>
  );
}
