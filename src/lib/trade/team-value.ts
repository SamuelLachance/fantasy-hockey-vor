/**
 * What a team is worth as a TEAM, not as a pile of players — the two
 * quantities a trade moves that no single player value shows:
 *
 * - `rosterValue`: the sum of the dynasty values of the players a roster can
 *   actually hold. A team that takes two players for one must let its
 *   cheapest player go (his value leaves with him); a team that sends two
 *   for one gains an open spot, filled by the best free agent. Minors-
 *   eligible players may sit in the minors (their own limit).
 * - `lineupPoints`: the season points of the team's best lineup — starters
 *   seated by eligibility (exact matroid fill, `fillSlots`), every other
 *   player of the active roster worth a share of his points (he plays when a
 *   starter's club is idle, under the games caps where the league has them;
 *   a fourth center on the bench still plays), an empty seat filled by the best
 *   free agent for it, the captain's ×1.5 on the best skater where the league
 *   has one.
 *
 * Pure: plain records in, numbers out (the trade tab and the backtest
 * `scripts/backtest-trade.ts` share these exact functions).
 */
import { fillSlots, type SlotSpec } from "../leagues/slot-fill";

export type Horizon = "winNow" | "balanced" | "longTerm";
export const HORIZONS: readonly Horizon[] = ["winNow", "balanced", "longTerm"];

export interface TeamPlayer {
  id: string;
  name: string;
  /** Lineup eligibility tokens (the league's own, e.g. "C", "W", "D", "G"). */
  pos: readonly string[];
  goalie: boolean;
  /** Dynasty value per horizon (league units). */
  dv: Readonly<Record<Horizon, number>>;
  /** Projected fantasy points over the rest of this season (0 when unknown). */
  fp: number;
  /** May sit in the minors (outside the main roster limit). */
  minorsOk: boolean;
}

export interface RosterRules {
  /** Players the main roster holds (Active + Reserve). */
  main: number;
  /** Minors spots (minors-eligible players only). */
  minors: number;
}

export interface LineupRules {
  /** Starting seats of ONE team: slot, count, eligibility tokens. */
  seats: ReadonlyArray<SlotSpec<string>>;
  /** Share of a bench skater's / goalie's points that still count. */
  benchShare: number;
  goalieBenchShare: number;
  /**
   * Players who can play: the best `rosterSize` by projected points (the
   * active roster: seats + reserve); the rest (minors, beyond the limit)
   * never do.
   */
  rosterSize: number;
  /** Extra multiplier of the best skater (Captains' captain: 0.5), 0 if none. */
  captainBonus: number;
}

export interface RosterValue {
  value: number;
  /** Players that no longer fit (released). */
  dropped: string[];
  /** Main-roster spots left open (each filled by a free agent of `faValues`). */
  open: number;
}

/**
 * The value a roster can hold under `h`. `faValues`: free agents' values,
 * best first (an open main spot takes the next one).
 */
export function rosterValue(
  players: readonly TeamPlayer[],
  h: Horizon,
  rules: RosterRules,
  faValues: readonly number[] = [],
): RosterValue {
  const v = (p: TeamPlayer) => Math.max(0, p.dv[h] ?? 0);
  const sorted = [...players].sort((a, b) => v(b) - v(a) || a.id.localeCompare(b.id));
  // Feasible sets: at most `main` ineligible players, at most `main + minors`
  // in all (an eligible player sits in the minors or on the main roster).
  // That is a matroid, so keeping players best first whenever they still fit
  // is optimal.
  let ine = 0;
  let all = 0;
  let value = 0;
  const dropped: string[] = [];
  for (const p of sorted) {
    const fits = all < rules.main + rules.minors && (p.minorsOk || ine < rules.main);
    if (!fits) {
      dropped.push(p.id);
      continue;
    }
    all++;
    if (!p.minorsOk) ine++;
    value += v(p);
  }
  const eligibleKept = all - ine;
  const open = Math.max(0, rules.main - ine - Math.max(0, eligibleKept - rules.minors));
  for (let k = 0; k < open; k++) value += Math.max(0, faValues[k] ?? 0);
  return { value, dropped, open };
}

export interface LineupResult {
  points: number;
  /** Starter points by seat (slot label → points of its seated players). */
  bySlot: Record<string, number>;
  /** Seats left empty (filled by the free-agent replacement). */
  empty: Record<string, number>;
  starters: string[];
}

/**
 * The season points of the best lineup. `faBySlot`: the best free agent's
 * points for each seat (an empty seat is a waiver claim away).
 */
export function lineupPoints(
  players: readonly TeamPlayer[],
  rules: LineupRules,
  faBySlot: Readonly<Record<string, number>> = {},
): LineupResult {
  const live = [...players]
    .filter((p) => p.fp > 0)
    .sort((a, b) => b.fp - a.fp || a.id.localeCompare(b.id))
    .slice(0, Math.max(0, rules.rosterSize));
  const fill = fillSlots<string, { id: string; positions: readonly string[]; p: TeamPlayer }, string>(
    live.map((p) => ({ id: p.id, positions: p.pos, p })),
    rules.seats,
  );
  const bySlot: Record<string, number> = {};
  const empty: Record<string, number> = {};
  let points = 0;
  let bestSkater = 0;
  for (const seat of rules.seats) {
    const seated = fill.bySlot.get(seat.slot) ?? [];
    let s = 0;
    for (const x of seated) {
      s += x.p.fp;
      if (!x.p.goalie) bestSkater = Math.max(bestSkater, x.p.fp);
    }
    const holes = Math.max(0, seat.capacity - seated.length);
    if (holes) {
      empty[seat.slot] = holes;
      s += holes * Math.max(0, faBySlot[seat.slot] ?? 0);
    }
    bySlot[seat.slot] = s;
    points += s;
  }
  for (const x of fill.unassigned) points += (x.p.goalie ? rules.goalieBenchShare : rules.benchShare) * x.p.fp;
  points += rules.captainBonus * bestSkater;
  return { points, bySlot, empty, starters: [...fill.slotOf.keys()] };
}

/**
 * Seats where a team is short: its starters' points per seat against the
 * league's median team at that seat, weakest first (a share below 1 = need).
 */
export function seatNeeds(
  mine: LineupResult,
  league: readonly LineupResult[],
  seats: ReadonlyArray<SlotSpec<string>>,
): Array<{ slot: string; share: number }> {
  return seats
    .map((s) => {
      const xs = league.map((l) => l.bySlot[s.slot] ?? 0).sort((a, b) => a - b);
      const med = xs[Math.floor(xs.length / 2)] ?? 0;
      return { slot: s.slot, share: med > 0 ? (mine.bySlot[s.slot] ?? 0) / med : 1 };
    })
    .sort((a, b) => a.share - b.share);
}

/** The best free agent's points for each seat. */
export function freeAgentBySlot(fas: readonly TeamPlayer[], seats: ReadonlyArray<SlotSpec<string>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of seats) {
    let best = 0;
    for (const p of fas) if (p.pos.some((t) => s.accepts.includes(t))) best = Math.max(best, p.fp);
    out[s.slot] = best;
  }
  return out;
}
