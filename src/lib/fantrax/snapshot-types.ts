/**
 * Shapes of the files `scripts/fantrax-sync.ts` bakes. Server code imports
 * the `src/data/fantrax/*` ones at build; the browser lazy-loads the
 * `public/fantrax/*` ones. A committed snapshot keeps builds offline-safe.
 */
import type { RosterLimits, SlotId } from "./config";
import type { IsoPeriod } from "./dates";
import type { RosterEntry } from "./roster-rules";
import type { ScoringTable } from "./scoring";

/** src/data/fantrax/league.json — settings that change a few times a season. */
export interface LeagueSnapshot {
  fetchedAt: string;
  leagueId: string;
  leagueName: string;
  seasonYear: number;
  startDate: string;
  endDate: string;
  slotCounts: Record<SlotId, number>;
  limits: RosterLimits;
  scoring: ScoringTable;
  /** Skt ÷ Default points, uniform across offensive categories. */
  sktMultiplier: number;
  /** Games caps per scoring period (null when fxpa never answered). */
  scoringPeriods: Array<IsoPeriod & { gpMax: number | null; gsMax: number | null }>;
  capsSource: "fxpa" | "none";
  /** Daily lineup periods; each starts at that day's first puck drop. */
  rosterPeriods: IsoPeriod[];
  teams: Array<{ id: string; name: string }>;
  playoffs: { firstPeriod: number; teams: number } | null;
}

/** public/fantrax/values.json record (per Fantrax id). */
export interface ValueRecord {
  /** Display name, "First Last". */
  n: string;
  /** Fantrax NHL team (the schedule always follows this, not players.json). */
  t: string;
  /** Fantrax eligiblePos, e.g. "W,C,F,Skt". */
  e: string;
  /** Projected games (skaters) or starts (goalies). */
  gp: number;
  /** Skater points per game in a C/W/F slot. */
  off?: number;
  /** Extra per game in a D slot (Blk, Tk, skater SHO). */
  dx?: number;
  /** Goalie expected points per start. */
  gE?: number;
  /** Goalie prior start share (tandem-renormalized, injuries removed). */
  pS?: number;
  age?: number;
  /** "prior" = no projection matched; league-wide fallback values. */
  src: "proj" | "prior";
}

export interface ValuesSnapshot {
  fetchedAt: string;
  season: string;
  /** Source players.json generatedAt. */
  projectionsAt: string;
  players: Record<string, ValueRecord>;
}

export interface CapUsage {
  gp: number;
  gpMax: number;
  gs: number;
  gsMax: number;
}

/** public/fantrax/state.json — changes daily. */
export interface StateSnapshot {
  fetchedAt: string;
  /** False when the unauthenticated fxpa batch failed: no caps, icons, Ros%. */
  fxpaOk: boolean;
  fxpaError?: string;
  /** Lineup period the rosters were read for. */
  rosterPeriod: number;
  scoringPeriod: number;
  rosters: Record<string, RosterEntry[]>;
  /** Unrostered players on waivers (everyone else unrostered is a free agent). */
  waivers: string[];
  icons: Record<string, string[]>;
  minorsEligible: string[];
  /** % of Fantrax leagues rostering the player this week. */
  ros: Record<string, number>;
  /** Season-to-date [FPts, GP] in league scoring (empty before opening night). */
  ytd: Record<string, [number, number]>;
  caps: Record<string, CapUsage>;
  /** Claims processed since `claimsWeekStart` (Monday, Eastern), per team. */
  claims: Record<string, number> | null;
  claimsWeekStart: string;
  draft: {
    state: string;
    picks: Array<{ pick: number; round: number; teamId: string; playerId?: string }>;
  } | null;
  /** Fantrax ADP (global, not this league) by Fantrax id. */
  adp: Record<string, number>;
  standings: Array<{ teamId: string; rank: number; record: string; pointsFor: number }>;
}

/** public/fantrax/schedule-20262027.json — [startUTC, away, home] per game. */
export interface ScheduleSnapshot {
  season: number;
  /** Last full-season rebuild (weekly). */
  fetchedAt: string;
  /** Last refresh of the current + next week (every sync). */
  updatedAt: string;
  games: Array<[string, string, string]>;
}

/** src/data/fantrax/nhl-ids.json — Fantrax id → NHL id. */
export interface NhlIdsSnapshot {
  fetchedAt: string;
  /** Match method counts, for the check script. */
  methods: Record<string, number>;
  ids: Record<string, number>;
}
