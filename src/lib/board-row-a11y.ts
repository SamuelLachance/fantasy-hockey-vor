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
