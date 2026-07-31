import type { Position } from "@/lib/types";

/** Visible label for the Starters / All G toolbar control. */
export function goalieDepthToggleLabel(hideDepthGoalies: boolean): string {
  return hideDepthGoalies ? "Starters" : "All G";
}

/** Accessible name — expands the compact All G label for AT. */
export function goalieDepthToggleAriaLabel(hideDepthGoalies: boolean): string {
  return hideDepthGoalies
    ? "Starter goalies only"
    : "All goalies including depth";
}

/** Tooltip for the Starters / All G control (state-aware when provided). */
export function goalieDepthToggleTitle(
  maxGp: number,
  hideDepthGoalies = true,
): string {
  if (!hideDepthGoalies) {
    return `Showing all goalies including org-depth at 4–${maxGp} GP (Shift+G)`;
  }
  return `Hide org-depth goalies at 4–${maxGp} GP (Shift+G)`;
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
