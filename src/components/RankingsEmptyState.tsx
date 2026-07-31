"use client";

import type { Position } from "@/lib/types";
import {
  EMPTY_BOARD_ACTION_LABELS,
  emptyBoardHintCopy,
  emptyBoardRecoveryFlags,
  emptyBoardStatusCopy,
} from "@/lib/board-empty-recovery";
import { EmptyAction } from "./EmptyAction";

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
  const actions = emptyBoardRecoveryFlags({
    query,
    activeFilterCount,
    position,
    canShowAllGoalies,
  });

  return (
    <div className="px-6 py-16 text-center text-slate-400" role="status">
      <p>{emptyBoardStatusCopy()}</p>
      <p className="mt-1 text-xs text-slate-500">{emptyBoardHintCopy()}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {actions.clearSearch && (
          <EmptyAction
            label={EMPTY_BOARD_ACTION_LABELS.clearSearch}
            onClick={onClearSearch}
            keyshortcuts="Escape"
          />
        )}
        {actions.clearStatFilters && (
          <EmptyAction
            label={EMPTY_BOARD_ACTION_LABELS.clearStatFilters}
            onClick={onClearStatFilters}
          />
        )}
        {actions.showAllPositions && (
          <EmptyAction
            label={EMPTY_BOARD_ACTION_LABELS.showAllPositions}
            onClick={onShowAllPositions}
          />
        )}
        {actions.showAllGoalies && (
          <EmptyAction
            label={EMPTY_BOARD_ACTION_LABELS.showAllGoalies}
            onClick={onShowAllGoalies}
            keyshortcuts="Shift+G"
          />
        )}
        <EmptyAction
          label={EMPTY_BOARD_ACTION_LABELS.resetBoard}
          onClick={onResetBoard}
          primary
          keyshortcuts="r"
        />
      </div>
    </div>
  );
}
