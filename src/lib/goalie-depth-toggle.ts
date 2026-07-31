import type { Position } from "@/lib/types";

/** Starters / All G toggle only applies on goalie-inclusive board views. */
export function canToggleDepthGoalies(position: Position | "ALL"): boolean {
  return position === "G" || position === "ALL";
}
