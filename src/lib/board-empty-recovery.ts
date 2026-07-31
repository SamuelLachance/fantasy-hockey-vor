import type { Position } from "@/lib/types";

/** Which recovery actions to show when the board filter set is empty. */
export function emptyBoardRecoveryFlags(input: {
  query: string;
  activeFilterCount: number;
  position: Position | "ALL";
  canShowAllGoalies: boolean;
}): {
  clearSearch: boolean;
  clearStatFilters: boolean;
  showAllPositions: boolean;
  showAllGoalies: boolean;
} {
  return {
    clearSearch: input.query.trim() !== "",
    clearStatFilters: input.activeFilterCount > 0,
    showAllPositions: input.position !== "ALL",
    showAllGoalies: input.canShowAllGoalies,
  };
}

/** Labels for empty-board recovery actions. */
export const EMPTY_BOARD_ACTION_LABELS = {
  clearSearch: "Clear search",
  clearStatFilters: "Clear stat filters",
  showAllPositions: "Show all positions",
  showAllGoalies: "Include depth goalies",
  resetBoard: "Reset board view",
} as const;

/** Clear-all chip on the active-filters strip. */
export function clearBoardFiltersCopy(): string {
  return "Clear filters";
}

/** Primary empty-board status line. */
export function emptyBoardStatusCopy(): string {
  return "No players match your filters.";
}

/** Hint under the empty-board status (keyboard recovery). */
export function emptyBoardHintCopy(): string {
  return "Press r to reset the board, or Esc after clearing search.";
}
