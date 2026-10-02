/**
 * Roster legality. An illegal roster scores NOTHING for the lineup period
 * ("This Team will not accumulate any stats for this lineup period"), so
 * this is the first thing the daily view checks.
 *
 * Rules, Captains league (public rules page +
 * `getTeamRosterInfo.miscData.statusTotals`): Active + Reserve >= 15 (Minors
 * and IR do not count); Active <= 15, Reserve <= 5, IR <= 6, Minors <= 35;
 * each active slot type at most its count; a healthy player on IR makes the
 * roster illegal after 2 lineup periods (any injury flag, day-to-day
 * included, or a suspension makes the IR slot legitimate). Moving players out
 * of Minors is never blocked.
 *
 * The numbers and the slot set are the league's, never the module's: pass
 * `limits` / `slotCounts` / `slotOrder` from the league's config and synced
 * snapshot. fxea only exposes maxActive and maxReserve, so minTotal, maxIr,
 * maxMinors and the IR grace period come from each league's rules page and
 * must never be inherited from another league.
 */
import {
  DEFAULT_ROSTER_LIMITS,
  DEFAULT_SLOT_COUNTS,
  FANTRAX_ICON,
  FANTRAX_NO_TEAM,
  IR_ELIGIBLE_ICONS,
  SLOT_ORDER,
  type RosterLimits,
  type SlotCounts,
  type SlotId,
} from "./config";

export interface RosterEntry {
  id: string;
  /** Lineup slot for ACTIVE players; ignored for other statuses. */
  slot: string;
  status: string;
  /** League salary in M$ as Fantrax lists it (salary-cap leagues; absent when 0). */
  sal?: number;
}

export interface PlayerFlags {
  icons?: readonly string[];
  /** Fantrax NHL team ("(N/A)" when clubless). */
  team?: string;
}

export type DeadReason =
  | "minor-leagues"
  | "injured"
  | "suspended"
  | "inactive"
  | "nhl-free-agent"
  | "no-team";

export type RosterIssueCode =
  | "below-min"
  | "too-many-active"
  | "too-many-reserve"
  | "too-many-ir"
  | "too-many-minors"
  | "too-many-total"
  | "slot-over"
  | "healthy-ir";

export interface RosterIssue {
  code: RosterIssueCode;
  /** True when the issue alone makes the lineup period score 0. */
  illegal: boolean;
  count: number;
  limit: number;
  slot?: SlotId;
  ids?: string[];
}

export interface SlotFill {
  max: number;
  filled: number;
  empty: number;
  /** Active players in this slot who cannot score (see `dead`). */
  dead: string[];
}

/** One entry per slot the league has, in its own order. */
export type SlotFills = Partial<Record<SlotId, SlotFill>>;

export interface RosterEvaluation {
  counts: { active: number; reserve: number; ir: number; minors: number; counted: number };
  minTotal: number;
  /** Players to add to Active/Reserve to reach the minimum. */
  need: number;
  illegal: boolean;
  issues: RosterIssue[];
  slots: SlotFills;
  dead: Array<{ id: string; slot: string; reason: DeadReason }>;
  healthyOnIr: string[];
  /** Minors players who can dress in the NHL today (no minor-league / injury flag). */
  movableFromMinors: string[];
}

export function deadReason(flags: PlayerFlags | undefined): DeadReason | null {
  const icons = flags?.icons ?? [];
  if (icons.includes(FANTRAX_ICON.minorLeagues)) return "minor-leagues";
  if (icons.includes(FANTRAX_ICON.injured) || icons.includes(FANTRAX_ICON.nhlInjuredReserve)) return "injured";
  if (icons.includes(FANTRAX_ICON.suspended)) return "suspended";
  if (icons.includes(FANTRAX_ICON.inactive)) return "inactive";
  if (icons.includes(FANTRAX_ICON.nhlFreeAgent)) return "nhl-free-agent";
  if (flags && (!flags.team || flags.team === FANTRAX_NO_TEAM)) return "no-team";
  return null;
}

export const isCountedStatus = (status: string) => status === "ACTIVE" || status === "RESERVE";

/** True when the player may legitimately sit in a Fantrax IR slot. */
export function irEligible(flags: PlayerFlags | undefined): boolean {
  return (flags?.icons ?? []).some((i) => IR_ELIGIBLE_ICONS.includes(i));
}

export function evaluateRoster(
  roster: RosterEntry[],
  flags: Record<string, PlayerFlags>,
  opts: {
    limits?: RosterLimits;
    slotCounts?: SlotCounts;
    /** The league's slots, in its own order (`config.slots.order`). */
    slotOrder?: readonly SlotId[];
    /** Lineup periods each IR player has already spent healthy there. */
    healthyIrPeriods?: Record<string, number>;
    /**
     * False when the injury / minor-league icons could not be fetched: then
     * nobody on IR or in Minors can be called healthy or playable.
     */
    iconsKnown?: boolean;
  } = {},
): RosterEvaluation {
  const limits = opts.limits ?? DEFAULT_ROSTER_LIMITS;
  const slotCounts = opts.slotCounts ?? DEFAULT_SLOT_COUNTS;
  const slotOrder = opts.slotOrder ?? SLOT_ORDER;
  const iconsKnown = opts.iconsKnown ?? true;
  const counts = { active: 0, reserve: 0, ir: 0, minors: 0, counted: 0 };
  const slots: SlotFills = Object.fromEntries(
    slotOrder.map((s) => [s, { max: slotCounts[s] ?? 0, filled: 0, empty: 0, dead: [] as string[] }]),
  );
  const dead: RosterEvaluation["dead"] = [];
  const healthyOnIr: string[] = [];
  const movableFromMinors: string[] = [];

  for (const r of roster) {
    if (r.status === "ACTIVE") {
      counts.active++;
      const fill = slots[r.slot as SlotId];
      if (fill) fill.filled++;
      const why = deadReason(flags[r.id]);
      if (why) {
        dead.push({ id: r.id, slot: r.slot, reason: why });
        fill?.dead.push(r.id);
      }
    } else if (r.status === "RESERVE") counts.reserve++;
    else if (r.status === "INJURED_RESERVE") {
      counts.ir++;
      if (iconsKnown && !irEligible(flags[r.id])) healthyOnIr.push(r.id);
    } else if (r.status === "MINORS") {
      counts.minors++;
      if (iconsKnown && !deadReason(flags[r.id])) movableFromMinors.push(r.id);
    }
  }
  counts.counted = counts.active + counts.reserve;
  for (const fill of Object.values(slots)) {
    if (fill) fill.empty = Math.max(0, fill.max - fill.filled);
  }

  const issues: RosterIssue[] = [];
  const need = Math.max(0, limits.minTotal - counts.counted);
  if (need > 0) {
    issues.push({ code: "below-min", illegal: true, count: counts.counted, limit: limits.minTotal });
  }
  const over = (code: RosterIssueCode, count: number, limit: number) => {
    if (count > limit) issues.push({ code, illegal: true, count, limit });
  };
  over("too-many-active", counts.active, limits.maxActive);
  over("too-many-reserve", counts.reserve, limits.maxReserve);
  over("too-many-ir", counts.ir, limits.maxIr);
  over("too-many-minors", counts.minors, limits.maxMinors);
  // A league's total (Slapshot: 40 = Active + Reserve + Minors; IR apart).
  if (limits.maxTotal !== undefined) over("too-many-total", counts.counted + counts.minors, limits.maxTotal);
  for (const s of slotOrder) {
    const f = slots[s];
    if (f && f.filled > f.max) {
      issues.push({ code: "slot-over", illegal: true, count: f.filled, limit: f.max, slot: s });
    }
  }
  if (healthyOnIr.length > 0) {
    const periods = opts.healthyIrPeriods ?? {};
    const expired = healthyOnIr.filter((id) => (periods[id] ?? 0) > limits.healthyIrGracePeriods);
    issues.push({
      code: "healthy-ir",
      illegal: expired.length > 0,
      count: healthyOnIr.length,
      limit: limits.healthyIrGracePeriods,
      ids: expired.length > 0 ? expired : healthyOnIr,
    });
  }

  return {
    counts,
    minTotal: limits.minTotal,
    need,
    illegal: issues.some((i) => i.illegal),
    issues,
    slots,
    dead,
    healthyOnIr,
    movableFromMinors,
  };
}
