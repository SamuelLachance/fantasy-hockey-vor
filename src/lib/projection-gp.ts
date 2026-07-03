import type { PlayerProfile } from "./profile-types";

const FULL_SEASON = 82;

/** Skaters use full-season GP — injuries are not predictable. Goalies use durability history. */
export function projectedGamesFromProfile(profile: PlayerProfile): number {
  if (!profile.isGoalie) {
    return FULL_SEASON;
  }

  const { injury } = profile;
  const historyGp = profile.teamHistory
    .filter((s) => s.gamesPlayed > 0)
    .map((s) => s.gamesPlayed);

  const avg = injury.avgGamesPlayedLast3 || injury.gamesPlayedLastSeason;
  if (avg > 0) {
    return Math.round(Math.min(58, Math.max(20, avg)));
  }

  if (historyGp.length > 0) {
    const historyAvg = historyGp.reduce((a, b) => a + b, 0) / historyGp.length;
    return Math.round(Math.min(58, Math.max(20, historyAvg)));
  }

  return 35;
}
