import { DEFAULT_LEAGUE } from "@/lib/league";
import type { LeagueSettings } from "@/lib/types";

const SKATER_CATS = "G, A, SOG, BLK, HIT, PPP, PIM, FOW";
const GOALIE_CATS = "W, SO, SV, SV%";

/** Compact roster/categories blurb for the header note. */
export function headerRosterCopy(
  league: LeagueSettings = DEFAULT_LEAGUE,
): string {
  const { C, LW, RW, D, G } = league.roster;
  return `Roster: ${C}C · ${LW}LW · ${RW}RW · ${D}D · ${G}G daily. Skater cats: ${SKATER_CATS}. Goalie cats: ${GOALIE_CATS}.`;
}

/** Accessible name for the roster note landmark. */
export function headerRosterNoteLabel(): string {
  return "League roster and category settings";
}
