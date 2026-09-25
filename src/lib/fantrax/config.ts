/**
 * Fantrax "Captains Dynasty League" settings shared by the sync script, the
 * CLI report and the /league page. Nothing here reads the network or `fs`.
 *
 * Slot counts and roster limits mirror `getLeagueInfo.rosterInfo` and the
 * public rules page; the sync re-reads them into league.json each run, so
 * these constants are only the fallback and the test fixture.
 */

export const FANTRAX_LEAGUE_ID = "aurcivgfmo2zpwm7";
/** Quebec Trashers — confirmed by the user as their team. */
export const FANTRAX_DEFAULT_TEAM_ID = "kgy7gzd8mo2zpwmj";
/** Fantrax season code for 2026-27 (`SEASON_31n_YEAR_TO_DATE`). */
export const FANTRAX_SEASON_CODE = "31n";
export const NHL_SEASON_ID = 20262027;

/** Lineup locks, claim resets and "today" all follow Eastern time. */
export const LEAGUE_TIME_ZONE = "America/Toronto";

/**
 * Descriptive UA for build-time requests. Browsers ignore it (forbidden
 * header), which is fine: fxea is CORS-open and fxpa is never called there.
 */
export const SYNC_USER_AGENT =
  "fantasy-hockey-vor-league-sync/1.0 (+https://samuellachance.github.io/fantasy-hockey-vor; read-only, <=1 req/s)";

export type SlotId = "C" | "W" | "F" | "D" | "Skt" | "G";

/** Order the lineup table renders in (matches the Fantrax roster page). */
export const SLOT_ORDER: readonly SlotId[] = ["C", "W", "F", "D", "Skt", "G"];

/** Active slots per lineup (C3 W5 F1 D3 Skt1 G2 = 15). */
export const DEFAULT_SLOT_COUNTS: Record<SlotId, number> = {
  C: 3,
  W: 5,
  F: 1,
  D: 3,
  Skt: 1,
  G: 2,
};

export interface RosterLimits {
  /** Active + Reserve must reach this or the whole lineup period scores 0. */
  minTotal: number;
  maxActive: number;
  maxReserve: number;
  maxIr: number;
  maxMinors: number;
  /** A healthy player left on IR makes the roster illegal after this many lineup periods. */
  healthyIrGracePeriods: number;
}

export const DEFAULT_ROSTER_LIMITS: RosterLimits = {
  minTotal: 15,
  maxActive: 15,
  maxReserve: 5,
  maxIr: 6,
  maxMinors: 35,
  healthyIrGracePeriods: 2,
};

/** FA + WW claims per week; the counter resets Monday (Eastern). */
export const CLAIMS_PER_WEEK = 5;

/**
 * How a defenseman in the Skt (captain) slot scores Blk / Tk / skater SHO.
 * "default": the Skt config has no rows for them, so Fantrax falls back to
 * Default = 0 (live 2025-26 scores: Hutson Blk:3 = 0; ~80% confidence).
 * "d": he keeps his D-slot values. Flip here if week-1 scoring disagrees.
 */
export type DInSktFallback = "default" | "d";
export const D_IN_SKT_FALLBACK: DInSktFallback = "default";

/**
 * Fantrax `scorer.icons[].typeId` values the tool acts on (tooltips seen in
 * the 2026-09-25 fxpa player lists). News icons (8/9/14) are ignored.
 */
export const FANTRAX_ICON = {
  /** "Day-to-Day" — may still dress; discounted, not ruled out. */
  dayToDay: "1",
  /** "Injured Reserve List" — on the NHL IR / LTIR. */
  nhlInjuredReserve: "2",
  /** Unsigned NHL free agent. */
  nhlFreeAgent: "3",
  /** "Minor Leagues" — assigned to the AHL/junior; earns nothing. */
  minorLeagues: "4",
  /** Suspended. */
  suspended: "6",
  /** "Inactive" — retired or out of the game. */
  inactive: "7",
  /** Injured ("Out Indefinitely"…). */
  injured: "30",
  /** Eligible for this league's Minors slots (<100 GP skater / <55 GP goalie, age <= 24). */
  minorsEligible: "31",
} as const;

/** Icons that zero a player's daily value outright. */
export const NON_PLAYING_ICONS: readonly string[] = [
  FANTRAX_ICON.injured,
  FANTRAX_ICON.nhlInjuredReserve,
  FANTRAX_ICON.suspended,
  FANTRAX_ICON.minorLeagues,
  FANTRAX_ICON.nhlFreeAgent,
  FANTRAX_ICON.inactive,
];

/**
 * Icons that make a Fantrax IR slot legitimate: any injury flag, and
 * suspensions ("Allow suspended players to be moved to Injured Reserve: Yes").
 */
export const IR_ELIGIBLE_ICONS: readonly string[] = [
  FANTRAX_ICON.dayToDay,
  FANTRAX_ICON.nhlInjuredReserve,
  FANTRAX_ICON.injured,
  FANTRAX_ICON.suspended,
];

/** Day-to-day players dress about half the time; their nightly value is discounted. */
export const DAY_TO_DAY_P_PLAY = 0.5;

/** Fantrax team label for players without an NHL club. */
export const FANTRAX_NO_TEAM = "(N/A)";

/**
 * Priors for players with no repo projection (2026 draftees, unmatched
 * prospects): p25 FP/G of 2025-26 regulars with >= 40 GP, and the 48th
 * goalie on the points ladder for E per start.
 */
export const PRIOR_FPG = { F: 2.52, D: 2.5 } as const;
export const PRIOR_GOALIE_E = 3.65;
/** Unprojected skaters rarely hold a nightly spot; discount their P(play). */
export const PRIOR_P_PLAY = 0.6;

/** Waiver targets below this gain over the rest of the scoring period are hidden. */
export const WAIVER_MIN_DELTA = 3;
/** Players this young with this Ros% are dynasty assets, never suggested as drops. */
export const DROP_PROTECT_MAX_AGE = 24;
export const DROP_PROTECT_MIN_ROS = 30;
/** The top-N players by season value are the keeper core: never dropped. */
export const DROP_PROTECT_TOP_N = 10;
