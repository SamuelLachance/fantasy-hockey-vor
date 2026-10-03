/**
 * The planner's rules that only some leagues have — a salary cap over the
 * counted spots and per-game lineup locks (Slapshot) — apart from
 * daily-plan.ts, so the planner's chunk, which every tab of every Fantrax
 * league loads, carries none of them. The browser imports this module only
 * for a league whose config needs it (`needsPlanKit`); the scripts and tests
 * pass `PLAN_KIT` to `buildDailyPlan` / `lineupTarget` directly, and both
 * throw when a league needs it and it is missing (never a silent plan without
 * its locks or its cap).
 */
import type { DailyPlan, PlanKit, ScheduleIndex } from "./daily-plan";
import { targetLineupPeriod, type IsoPeriod } from "./dates";
import type { RosterEntry } from "./roster-rules";
import { capFitAdvice } from "./cap-fit";
import { salaryUsage } from "./salary-cap";
import type { ValuesSnapshot } from "./snapshot-types";

/** Lock of the last game of a lineup period (its start minus the lead), null without a game. */
export function lastLockMs(index: ScheduleIndex, period: number, minutesBefore: number): number | null {
  const games = index.byPeriod.get(period);
  if (!games?.size) return null;
  let last = Number.NEGATIVE_INFINITY;
  for (const g of games.values()) last = Math.max(last, Date.parse(g.startUTC));
  return last - minutesBefore * 60_000;
}

/**
 * Game lock (each player locks `minutesBefore` his own game): the lineup
 * period to set now is the first whose last game has not locked, so today's
 * lineup stays the target all evening.
 */
export function gameLockTarget<P extends IsoPeriod>(
  periods: P[],
  index: ScheduleIndex,
  nowMs: number,
  minutesBefore: number,
): P | null {
  return targetLineupPeriod(periods, nowMs, (p) => lastLockMs(index, p.number, minutesBefore));
}

/**
 * Who is locked in the target period (his game's lock has passed: the
 * optimizer holds him where he is) and the plan's `locks` block: the earliest
 * lock still ahead among this team's players who play in it, else that
 * period's last lock when the plan moves to the next day.
 */
export function gameLocks(a: {
  roster: readonly RosterEntry[];
  values: ValuesSnapshot;
  index: ScheduleIndex;
  target: { number: number } | null;
  nowMs: number;
  minutesBefore: number;
}): { lockedIds: Set<string>; locks: NonNullable<DailyPlan["locks"]> } {
  const lead = a.minutesBefore * 60_000;
  const targetGames = a.target ? a.index.byPeriod.get(a.target.number) : undefined;
  const lockOf = (id: string): number | null => {
    const g = targetGames?.get(a.values.players[id]?.t ?? "");
    return g ? Date.parse(g.startUTC) - lead : null;
  };
  const lockedIds = new Set(a.roster.map((r) => r.id).filter((id) => (lockOf(id) ?? Number.POSITIVE_INFINITY) <= a.nowMs));
  const ahead = a.roster.map((r) => lockOf(r.id)).filter((t): t is number => t !== null && t > a.nowMs);
  const lastMs = a.target ? lastLockMs(a.index, a.target.number, a.minutesBefore) : null;
  const nextMs = ahead.length ? Math.min(...ahead) : lastMs !== null && lastMs > a.nowMs ? lastMs : null;
  return {
    lockedIds,
    locks: {
      minutesBefore: a.minutesBefore,
      next: nextMs === null ? null : new Date(nextMs).toISOString(),
      last: lastMs === null ? null : new Date(lastMs).toISOString(),
      locked: [...lockedIds],
    },
  };
}

export const PLAN_KIT: PlanKit = { salaryUsage, gameLockTarget, gameLocks, capFit: capFitAdvice };
