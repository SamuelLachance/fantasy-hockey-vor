/**
 * Split seasons: an NHL season a player shared with another league.
 *
 * The NHL feeds only count NHL games, so a 14-game season reads the same
 * whether the player missed 68 games hurt or spent them at Boston
 * University before he signed (Cole Hutson, 2025-26). Games played in
 * another club league (src/lib/league-seasons.ts) are not absences: a
 * season with at least SPLIT_SEASON_MIN_OTHER_GAMES of them is a split
 * season, left out of the injury profile (src/lib/player-profile.ts).
 */

import {
  isClubLeague,
  loadLeagueSeasonsSync,
  type LeagueSeasonLine,
  type LeagueSeasonsCache,
} from "./league-seasons";
import type { OtherLeagueSeason, PlayerProfile } from "./profile-types";

/**
 * Club games in another league that make an NHL season a split season. An
 * injured veteran's conditioning loan lasts at most 14 days (1–5 AHL
 * games) and must not turn his injury season into a split one.
 */
export const SPLIT_SEASON_MIN_OTHER_GAMES = 6;

/** Availability given to a player with no NHL-only season to measure (a regular's typical share). */
export const UNMEASURED_DURABILITY = 0.9;

/** Club games outside the NHL per season, from league lines (only seasons with any). */
export function otherLeaguesFromLines(
  lines: LeagueSeasonLine[],
  seasonIds?: Iterable<number>,
): OtherLeagueSeason[] {
  const keep = seasonIds ? new Set(seasonIds) : null;
  const bySeason = new Map<number, OtherLeagueSeason>();
  for (const [seasonId, league, gp] of lines) {
    if (!isClubLeague(league) || !(gp > 0)) continue;
    if (keep && !keep.has(seasonId)) continue;
    const row = bySeason.get(seasonId) ?? { seasonId, gamesPlayed: 0, leagues: [] };
    row.gamesPlayed += gp;
    if (!row.leagues.includes(league)) row.leagues.push(league);
    bySeason.set(seasonId, row);
  }
  return [...bySeason.values()].sort((a, b) => a.seasonId - b.seasonId);
}

/**
 * The profile's club games outside the NHL: its own field when collected
 * with it, else the league-seasons cache (seasons of its NHL history).
 * Undefined when neither knows the player.
 */
export function otherLeaguesForProfile(
  profile: Pick<PlayerProfile, "id" | "teamHistory" | "otherLeagues">,
  cache: LeagueSeasonsCache | null = loadLeagueSeasonsSync(),
): OtherLeagueSeason[] | undefined {
  if (profile.otherLeagues) return profile.otherLeagues;
  const player = cache?.players[String(profile.id)];
  if (!player) return undefined;
  return otherLeaguesFromLines(
    player.seasons,
    profile.teamHistory.map((s) => s.seasonId),
  );
}

export function isSplitSeason(otherGames: number): boolean {
  return otherGames >= SPLIT_SEASON_MIN_OTHER_GAMES;
}

export interface SplitSeasonInfo {
  seasonId: number;
  nhlGames: number;
  otherGames: number;
  leagues: string[];
}

/**
 * The player's last NHL season (skater or goalie rows as asked) when it was
 * a split season, else null.
 */
export function lastSeasonSplit(
  profile: Pick<PlayerProfile, "id" | "teamHistory" | "otherLeagues">,
  isGoalie: boolean,
  cache?: LeagueSeasonsCache | null,
): SplitSeasonInfo | null {
  const last = profile.teamHistory
    .filter((s) => s.isGoalie === isGoalie && s.gamesPlayed > 0)
    .at(-1);
  if (!last) return null;
  const other = (
    cache === undefined ? otherLeaguesForProfile(profile) : otherLeaguesForProfile(profile, cache)
  )?.find((o) => o.seasonId === last.seasonId);
  if (!other || !isSplitSeason(other.gamesPlayed)) return null;
  return {
    seasonId: last.seasonId,
    nhlGames: last.gamesPlayed,
    otherGames: other.gamesPlayed,
    leagues: other.leagues,
  };
}
