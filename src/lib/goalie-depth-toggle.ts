import type { Position } from "@/lib/types";

/** Visible label for the Starters / All G toolbar control. */
export function goalieDepthToggleLabel(hideDepthGoalies: boolean): string {
  return hideDepthGoalies ? "Starters" : "All G";
}

/** Starters / All G toggle only applies on goalie-inclusive board views. */
export function canToggleDepthGoalies(position: Position | "ALL"): boolean {
  return position === "G" || position === "ALL";
}

/** Empty-state / footer path to expand depth goalies while Starters is on. */
export function canOfferAllGoalies(
  hideDepthGoalies: boolean,
  position: Position | "ALL",
): boolean {
  return hideDepthGoalies && canToggleDepthGoalies(position);
}
