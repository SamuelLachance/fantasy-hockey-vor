import type { LeagueSettings } from "./types";

export const DEFAULT_LEAGUE: LeagueSettings = {
  teams: 12,
  roster: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
  season: "2026-27",
  // Yahoo H2H categories: goalie value is discounted because weekly goalie
  // starts are volatile, goalie categories are streamable off waivers, and
  // goalie skill stats (SV%/SO) are near-unpredictable season-to-season.
  // Prefer volume (wins/saves/GP) over skill in rankings. At 0.2 the top goalie
  // drafts mid-round 3-ish. Tune to taste (1 = none).
  goalieVorFactor: 0.2,
};

/**
 * How deep the "draftable pool" runs at each position, as a multiple of
 * starter slots (starters + likely benched/streamed players). Z-score
 * baselines and scarcity weights are computed over this pool so the hundreds
 * of fringe players projected near zero don't distort category spreads.
 */
export const DRAFTABLE_POOL_FACTOR = 1.5;

export function draftablePoolSize(
  position: keyof LeagueSettings["roster"],
  teams: number = DEFAULT_LEAGUE.teams,
  roster: LeagueSettings["roster"] = DEFAULT_LEAGUE.roster,
): number {
  return Math.ceil(teams * roster[position] * DRAFTABLE_POOL_FACTOR);
}

export function replacementRank(
  position: keyof LeagueSettings["roster"],
  teams: number = DEFAULT_LEAGUE.teams,
  roster: LeagueSettings["roster"] = DEFAULT_LEAGUE.roster,
): number {
  return teams * roster[position];
}
