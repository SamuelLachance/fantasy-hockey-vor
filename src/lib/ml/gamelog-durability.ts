/**
 * Game-log-derived durability: injury spells and roster-aware availability.
 *
 * Season GP totals conflate three different absences: injury spells
 * (consecutive missed team games), healthy scratches (isolated misses), and
 * roster timing (call-ups/send-downs cutting the season window). These have
 * very different predictive meaning for next-season GP, so we derive them
 * from per-player game logs instead of feeding the model raw GP alone.
 *
 * Team schedules are reconstructed as the union of game dates across all
 * collected player logs per team-season (every team game has ≥18 dataset
 * players dressed, so coverage is complete) — no separate schedule fetches.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { PlayerSeasonRow } from "./types";

/** Minimal per-game record kept in the raw cache. */
export interface RawGameEntry {
  /** Game date YYYY-MM-DD. */
  d: string;
  /** Team abbreviation the player dressed for. */
  t: string;
}

/** Raw cache file per season: playerId → games (ascending by date). */
export type SeasonLogCache = Record<string, RawGameEntry[]>;

/** Derived per player-season. All counts are in team games. */
export interface DurabilityRecord {
  /** Games the player appeared in. */
  played: number;
  /** Team games from first to last appearance (inclusive). */
  window: number;
  /** Team games before first appearance (call-up timing / early injury). */
  head: number;
  /** Team games after last appearance (late injury / send-down). */
  tail: number;
  /** Missed games inside same-team gaps of ≥3 (skater injury spells). */
  inj: number;
  /** Missed games inside same-team gaps of ≥8 (goalie injury spells). */
  inj8: number;
  /** Missed games inside same-team gaps of 1–2 (scratches / rest). */
  scratch: number;
  /** Missed games spanning a team change (trade transition, not injury). */
  trans: number;
  /** Number of same-team gaps ≥3. */
  spells: number;
  /** Number of same-team gaps ≥8. */
  spells8: number;
  /** Longest same-team gap. */
  longestGap: number;
  /** window / full-season team games (roster-time share of the season). */
  share: number;
  /** Full-season team games (union-of-logs schedule length, last team). */
  teamGames: number;
  /**
   * Ending ironman streak: consecutive last-team games dressed ending at the
   * player's final appearance (0 if they finished the season injured/out).
   */
  streak: number;
  /** 1 if the player dressed for every last-team game this season. */
  fullSeason: number;
  /**
   * Games missed among the last team's final 10 schedule games while the
   * player was still active (last appearance in that window). Proxy for
   * late-season rest / load management when combined with team contention.
   */
  lateMiss: number;
  /** Games dressed among the last team's final 10 schedule games. */
  latePlayed: number;
  /**
   * Back-to-back pairs on the last team's schedule (consecutive games one
   * calendar day apart). Goalie starters almost never play both nights.
   */
  teamB2b: number;
}

export interface DurabilityRegistry {
  builtAt: string;
  /** `${playerId}:${seasonId}` → record. */
  byKey: Record<string, DurabilityRecord>;
}

export const GAMELOG_CACHE_DIR = join(
  process.cwd(),
  "src",
  "data",
  "ml",
  "gamelog-cache",
);
export const DURABILITY_PATH = join(
  process.cwd(),
  "src",
  "data",
  "ml",
  "durability.json",
);

export function durabilityKey(playerId: number, seasonId: number): string {
  return `${playerId}:${seasonId}`;
}

// ---------------------------------------------------------------------------
// Derivation

/** Sorted unique game dates per team from the union of player logs. */
export function buildTeamSchedules(cache: SeasonLogCache): Map<string, string[]> {
  const byTeam = new Map<string, Set<string>>();
  for (const games of Object.values(cache)) {
    for (const g of games) {
      let set = byTeam.get(g.t);
      if (!set) {
        set = new Set();
        byTeam.set(g.t, set);
      }
      set.add(g.d);
    }
  }
  const out = new Map<string, string[]>();
  for (const [team, dates] of byTeam) {
    out.set(team, [...dates].sort());
  }
  return out;
}

/** Count of schedule dates strictly between a and b (exclusive both ends). */
function gamesBetween(schedule: string[], a: string, b: string): number {
  // Binary search bounds; schedules are ≤82 entries so linear would also do,
  // but this runs ~20k × ~80 times.
  let lo = 0;
  let hi = schedule.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (schedule[mid] <= a) lo = mid + 1;
    else hi = mid;
  }
  let count = 0;
  for (let i = lo; i < schedule.length && schedule[i] < b; i++) count++;
  return count;
}

function gamesBefore(schedule: string[], a: string): number {
  let count = 0;
  for (const d of schedule) {
    if (d < a) count++;
    else break;
  }
  return count;
}

function gamesAfter(schedule: string[], a: string): number {
  let count = 0;
  for (let i = schedule.length - 1; i >= 0; i--) {
    if (schedule[i] > a) count++;
    else break;
  }
  return count;
}

/** Count consecutive schedule pairs one calendar day apart. */
export function countBackToBacks(schedule: string[]): number {
  let n = 0;
  for (let i = 1; i < schedule.length; i++) {
    const a = Date.parse(schedule[i - 1] + "T12:00:00Z");
    const b = Date.parse(schedule[i] + "T12:00:00Z");
    if (Number.isFinite(a) && Number.isFinite(b) && b - a === 86_400_000) n++;
  }
  return n;
}

export function deriveDurability(
  games: RawGameEntry[],
  schedules: Map<string, string[]>,
): DurabilityRecord | null {
  if (games.length === 0) return null;
  const sorted = [...games].sort((x, y) => (x.d < y.d ? -1 : x.d > y.d ? 1 : 0));

  let inj = 0;
  let inj8 = 0;
  let scratch = 0;
  let trans = 0;
  let spells = 0;
  let spells8 = 0;
  let longestGap = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev.t === cur.t) {
      const sched = schedules.get(cur.t);
      if (!sched) continue;
      const gap = gamesBetween(sched, prev.d, cur.d);
      if (gap >= 3) {
        inj += gap;
        spells++;
      } else if (gap >= 1) {
        scratch += gap;
      }
      if (gap >= 8) {
        inj8 += gap;
        spells8++;
      }
      if (gap > longestGap) longestGap = gap;
    } else {
      // Trade / reassignment across teams: count destination-team games
      // missed in transit, but don't classify as injury or scratch.
      const sched = schedules.get(cur.t);
      if (sched) trans += gamesBetween(sched, prev.d, cur.d);
    }
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const firstSched = schedules.get(first.t) ?? [];
  const lastSched = schedules.get(last.t) ?? [];
  const head = gamesBefore(firstSched, first.d);
  const tail = gamesAfter(lastSched, last.d);
  const played = sorted.length;
  const window = played + inj + scratch + trans;
  const teamGames = lastSched.length;

  // Ending ironman streak on the last team: walk the schedule backwards from
  // the player's final appearance while they keep dressing. Only counts when
  // the player was active through the season's end (tail === 0) — a streak
  // that ends in a season-ending injury is not an ironman signal.
  const playedSet = new Set(
    sorted.filter((g) => g.t === last.t).map((g) => g.d),
  );
  let streak = 0;
  if (tail === 0) {
    const endIdx = lastSched.indexOf(last.d);
    for (let i = endIdx; i >= 0; i--) {
      if (!playedSet.has(lastSched[i])) break;
      streak++;
    }
  }

  // Late-season availability among the last 10 team games (rest / load mgmt).
  const lateWindow = lastSched.slice(-10);
  let latePlayed = 0;
  for (const d of lateWindow) {
    if (playedSet.has(d)) latePlayed++;
  }
  const lateMiss = lateWindow.length - latePlayed;

  return {
    played,
    window,
    head,
    tail,
    inj,
    inj8,
    scratch,
    trans,
    spells,
    spells8,
    longestGap,
    share: teamGames > 0 ? window / teamGames : 1,
    teamGames,
    streak,
    fullSeason: teamGames > 0 && playedSet.size >= teamGames ? 1 : 0,
    lateMiss,
    latePlayed,
    teamB2b: countBackToBacks(lastSched),
  };
}

// ---------------------------------------------------------------------------
// Registry load + row attachment

let registryCache: DurabilityRegistry | null | undefined;

export function loadDurabilityRegistrySync(): DurabilityRegistry | null {
  if (registryCache !== undefined) return registryCache;
  if (!existsSync(DURABILITY_PATH)) {
    registryCache = null;
    return null;
  }
  try {
    registryCache = JSON.parse(
      readFileSync(DURABILITY_PATH, "utf8"),
    ) as DurabilityRegistry;
  } catch {
    registryCache = null;
  }
  return registryCache;
}

/**
 * Attach durability records to dataset rows in place (row.dur). Call once
 * after loading dataset.json; keeps the dataset file itself unchanged.
 */
export function attachDurability(rows: PlayerSeasonRow[]): number {
  const reg = loadDurabilityRegistrySync();
  if (!reg) return 0;
  let attached = 0;
  for (const row of rows) {
    const rec = reg.byKey[durabilityKey(row.playerId, row.seasonId)];
    if (rec) {
      row.dur = rec;
      attached++;
    }
  }
  return attached;
}
