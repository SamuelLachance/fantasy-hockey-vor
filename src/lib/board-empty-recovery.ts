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
