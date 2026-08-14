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
  showLinkedPlayer: "Show linked player",
} as const;

/** Clear-all chip on the active-filters strip. */
export function clearBoardFiltersCopy(): string {
  return "Clear filters";
}

/** Primary empty-board status line. */
export function emptyBoardStatusCopy(linkedName?: string | null): string {
  if (linkedName) return `${linkedName} is hidden by the current filters.`;
  return "No players match your filters.";
}

/** Hint under the empty-board status (pointer-first, keyboard secondary). */
export function emptyBoardHintCopy(): string {
  return "Use the buttons below to clear filters or reset the board. Keyboard: r resets; Esc clears search.";
}
