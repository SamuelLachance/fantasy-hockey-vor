import { positionFilterTabLabel } from "@/lib/board-positions";
import type { PlayerProjection, Position } from "@/lib/types";

/** Accessible name for the rankings data table (includes position filter). */
export function boardTableAriaLabel(position: Position | "ALL"): string {
  if (position === "ALL") return "Fantasy hockey VOR rankings";
  return `Fantasy hockey VOR rankings · ${positionFilterTabLabel(position)}`;
}

/**
 * Header + filtered data rows for virtualized/partial DOM tables.
 * Omit when there are no data rows.
 */
export function boardTableAriaRowCount(
  filteredCount: number,
): number | undefined {
  if (filteredCount <= 0) return undefined;
  return filteredCount + 1;
}

/** 1-based data-row index; header occupies row 1. */
export function boardTableAriaRowIndex(visibleIndex: number): number {
  return visibleIndex + 2;
}

/** Accessible name for a board table row. */
export function boardRowAriaLabel(
  player: Pick<PlayerProjection, "name" | "rank"> & {
    position?: Position;
    positionRank?: number | null;
    positionRanks?: Partial<Record<Position, number>>;
  },
  position: Position | "ALL",
  fallbackIndex: number,
): string {
  if (position === "ALL") {
    return `${player.name}, rank ${player.rank}`;
  }
  // Announce the rank *at the filtered position*, matching the visible cell.
  const rank =
    player.positionRanks?.[position] ??
    (position === player.position ? player.positionRank : undefined) ??
    player.positionRank ??
    fallbackIndex + 1;
  return `${player.name}, position rank ${rank}`;
}

/** Accessible name for the expanded details region. */
export function boardRowDetailsAriaLabel(playerName: string): string {
  return `${playerName} details`;
}

/** Tooltip for Edge cell (consensus − model). */
export function edgeCellTitle(
  consensusRank: number | null | undefined,
  modelRank: number,
): string | undefined {
  if (consensusRank == null) return undefined;
  return `Consensus rank ${consensusRank} − model rank ${modelRank}`;
}

/** Tooltip for Σσ cell. */
export function sigmaCellTitle(sigma: number | null | undefined): string {
  if (sigma == null) return "No calibrated uncertainty";
  return `Σσ ${sigma.toFixed(1)} (lower = more confident)`;
}

/** Visible Σσ cell text. */
export function sigmaCellDisplay(sigma: number | null | undefined): string {
  return sigma != null ? sigma.toFixed(0) : "—";
}
