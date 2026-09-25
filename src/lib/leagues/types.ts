import type { Position, SkaterCategory } from "../types";

/**
 * League profiles for leagues whose settings differ from the main board's
 * `DEFAULT_LEAGUE`. Additive only: `LeagueSettings` / `DEFAULT_LEAGUE` and the
 * committed `players.json` are untouched — a profile feeds the parameterised
 * category engine in `category-vor.ts` and writes its own board file.
 */

/** Every roster slot a Yahoo hockey league can list. */
export type RosterSlot =
  | "C"
  | "LW"
  | "RW"
  | "F"
  | "D"
  | "Util"
  | "G"
  | "BN"
  | "IR+"
  | "NA";

/** Slots that score (the daily lineup). BN/IR+/NA never score. */
export type StartingSlot = "C" | "LW" | "RW" | "F" | "D" | "Util" | "G";

export const STARTING_SLOTS: readonly StartingSlot[] = [
  "C",
  "LW",
  "RW",
  "F",
  "D",
  "Util",
  "G",
];

/**
 * Goalie categories a profile can score. GAA is new relative to the main
 * board (which scores saves instead); it is derived from saves and SV%.
 */
export type LeagueGoalieCategory =
  | "wins"
  | "goalsAgainstAverage"
  | "savePct"
  | "shutouts";

export type LeagueCategory = SkaterCategory | LeagueGoalieCategory;

export interface CategoryLeagueProfile {
  slug: string;
  name: string;
  platform: "yahoo";
  leagueId: number;
  /** The user's own team in the league (informational; no API calls). */
  teamId: number;
  season: string;
  format: "redraft" | "keeper" | "dynasty";
  scoring: "h2h-categories";
  matchupPeriod: "weekly";
  /** "Weekly Deadline: Daily - Today" → lineups can change every day. */
  lineupChanges: "daily";
  /** Matchup weeks including playoffs (last playoff week). */
  matchupWeeks: number;
  teams: number;
  categories: {
    skater: SkaterCategory[];
    goalie: LeagueGoalieCategory[];
  };
  /** Count per roster slot, as listed by the league. */
  roster: Record<RosterSlot, number>;
  /** Which player positions may fill each starting slot. */
  slotEligibility: Record<StartingSlot, Position[]>;
  minGoalieAppearancesPerWeek: number;
  maxAcquisitionsPerWeek: number | null;
  maxAcquisitionsPerSeason: number | null;
  maxTradesPerSeason: number | null;
  tradeEndDate: string;
  waivers: { days: number; type: string; mode: string };
  playoffs: { teams: number; weeks: number[]; endsOn: string; reseeding: boolean };
  draft: {
    type: "live-standard";
    order: "snake";
    /** ISO 8601 with offset. */
    startsAt: string;
    pickSeconds: number;
    /** Drafted rounds = every non-IR/NA roster spot. */
    rounds: number;
    /** Our 1-based slot in the snake; null until the order is published. */
    mySlot: number | null;
  };
  source: string;
}
