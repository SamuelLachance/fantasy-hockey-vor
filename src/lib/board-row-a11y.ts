import type { PlayerProjection, Position } from "@/lib/types";

/** Accessible name for a board table row. */
export function boardRowAriaLabel(
  player: Pick<PlayerProjection, "name" | "rank"> & {
    positionRank?: number | null;
  },
  position: Position | "ALL",
  fallbackIndex: number,
): string {
  if (position === "ALL") {
    return `${player.name}, rank ${player.rank}`;
  }
  return `${player.name}, position rank ${player.positionRank ?? fallbackIndex + 1}`;
}

/** Accessible name for the expanded details region. */
export function boardRowDetailsAriaLabel(playerName: string): string {
  return `${playerName} details`;
}
