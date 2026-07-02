import type { LeagueSettings } from "./types";

export const DEFAULT_LEAGUE: LeagueSettings = {
  teams: 12,
  roster: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
  season: "2026-27",
};

export function replacementRank(
  position: keyof LeagueSettings["roster"],
  teams: number = DEFAULT_LEAGUE.teams,
  roster: LeagueSettings["roster"] = DEFAULT_LEAGUE.roster,
): number {
  return teams * roster[position];
}
