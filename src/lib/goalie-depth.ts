import type { PlayerProjection, Position } from "@/lib/types";
import { vorForFilter } from "@/lib/rankings-filters";

/**
 * Org-depth / tandem goalies at or below this GP stay hidden when Starters
 * mode is on (board + top-lists).
 */
export const GOALIE_DEPTH_MAX_GP = 8;

/** True when a goalie clears the starter GP floor (skaters always pass). */
export function isStarterEligibleGoalie(player: {
  isGoalie?: boolean;
  gamesPlayed: number;
}): boolean {
  return !player.isGoalie || player.gamesPlayed > GOALIE_DEPTH_MAX_GP;
}

export interface PositionLeadersGroup {
  position: Position;
  players: PlayerProjection[];
}

/** Top-N leaders per position (starter goalies only for G). */
export function topByPositionLeaders(
  players: PlayerProjection[],
  limit = 3,
): PositionLeadersGroup[] {
  return (["C", "LW", "RW", "D", "G"] as const).map((position) => ({
    position,
    players: players
      .filter((p) => p.positions.includes(position))
      .filter((p) => position !== "G" || isStarterEligibleGoalie(p))
      .sort((a, b) => vorForFilter(b, position) - vorForFilter(a, position))
      .slice(0, limit),
  }));
}
