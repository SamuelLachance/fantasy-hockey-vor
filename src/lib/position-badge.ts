import type { Position } from "@/lib/types";

/** Tooltip for a position badge (highlight = VOR slot). */
export function positionBadgeTitle(
  position: Position,
  highlight: boolean,
): string {
  return highlight ? `VOR calculated at ${position}` : position;
}

/** Accessible name for a position badge. */
export function positionBadgeAriaLabel(
  position: Position,
  highlight: boolean,
): string {
  return highlight ? `${position}, VOR position` : `Position ${position}`;
}

/** Deduplicate eligibility list while preserving order. */
export function uniquePositions(positions: readonly Position[]): Position[] {
  return [...new Set(positions)];
}
