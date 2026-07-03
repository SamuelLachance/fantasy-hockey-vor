import type { PlayerProfile } from "./profile-types";

const FULL_SEASON = 82;

/** Projected GP from durability — not a blanket 82 for everyone. */
export function projectedGamesFromProfile(profile: PlayerProfile): number {
  const { injury } = profile;
  const historyGp = profile.teamHistory
    .filter((s) => s.gamesPlayed > 0)
    .map((s) => s.gamesPlayed);

  if (profile.isGoalie) {
    const avg = injury.avgGamesPlayedLast3 || injury.gamesPlayedLastSeason;
    if (avg > 0) {
      return Math.round(Math.min(58, Math.max(20, avg)));
    }
    return 35;
  }

  if (injury.avgGamesPlayedLast3 > 0) {
    const durability = injury.durabilityScore;
    const base = injury.avgGamesPlayedLast3;
    const adjusted = base * (0.75 + durability * 0.25);
    return Math.round(Math.min(FULL_SEASON, Math.max(25, adjusted)));
  }

  if (injury.gamesPlayedLastSeason > 0) {
    return Math.round(
      Math.min(FULL_SEASON, Math.max(25, injury.gamesPlayedLastSeason)),
    );
  }

  if (historyGp.length > 0) {
    const avg = historyGp.reduce((a, b) => a + b, 0) / historyGp.length;
    return Math.round(Math.min(FULL_SEASON, Math.max(25, avg)));
  }

  return 55;
}
