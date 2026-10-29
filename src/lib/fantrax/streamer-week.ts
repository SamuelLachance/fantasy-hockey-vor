/**
 * The week's streaming plan of one team, from the same inputs as its daily
 * plan: the next 7 lineup days of its roster, the best free agents of each
 * position over them, the claims it has left and its games caps, solved by
 * `planStreamers` (streamers.ts). Apart from daily-plan.ts, whose chunk every
 * tab of every Fantrax league loads: only the Ballottage tab loads this one
 * (on demand), and the CLI report calls it.
 */
import { CAPTAINS_DYNASTY, eligibleGroups } from "./config";
import { addDays, claimWeekStart, scoringPeriodAt, torontoDate } from "./dates";
import { availableProjected } from "./draft-inputs";
import { bestFpg, candidateFor, indexSchedule, pickupAvailable, planCtx, rosterCandidates, type DailyPlan, type PlanInputs } from "./daily-plan";
import { isRuledOut } from "./points-model";
import { planStreamers, type StreamDay } from "./streamers";
import type { WaiverCap } from "./waivers";

/** Lineup days the plan looks at, the free agents tried per position, and the claims of a league with no limit. */
export const STREAM_DAYS = 7;
export const STREAM_POOL_PER_GROUP = 12;
export const STREAM_CLAIMS_UNLIMITED = 4;

export interface StreamerWeek {
  /** Eastern date of each lineup day the plan looks at. */
  days: string[];
  steps: Array<{
    id: string;
    status: "FA" | "WW";
    /** Index in `days` of the first / last day of the stretch. */
    from: number;
    to: number;
    /** Expected games (starts, for a goalie) the stretch gives the lineup. */
    games: number;
    gain: number;
    /** The player let go for this claim (the first step only; later ones replace the previous streamer). */
    drop: { id: string; action: "drop" | "minors" } | null;
  }>;
  /** Points over the days against no claim, under the games caps / without them. */
  gain: number;
  gainUncapped: number;
  capLimited: boolean;
  /** Claims the plan could use (null: no limit in this league). */
  claimsAvailable: number | null;
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

/** Null: no claim pays for itself, or nothing to plan (no target period, or a baked plan from before `streamInputs`). */
export function streamerWeek(input: PlanInputs, plan: DailyPlan): StreamerWeek | null {
  const si = plan.streamInputs;
  const targetNumber = plan.target?.rosterPeriod;
  if (!si || targetNumber === undefined) return null;
  const { league, state, values, schedule, teamId, nowMs } = input;
  const config = input.config ?? CAPTAINS_DYNASTY;
  const index = indexSchedule(schedule, league.rosterPeriods);
  const ctx = planCtx(input, config, index);
  const roster = state.rosters[teamId] ?? [];
  const waiverSet = new Set(state.waivers);
  const todayEt = torontoDate(nowMs);
  const locked = new Set(plan.locks?.locked ?? []);
  const withLocks = (cands: ReturnType<typeof rosterCandidates>, period: number) =>
    locked.size && period === targetNumber ? cands.map((c) => (locked.has(c.id) ? { ...c, locked: true } : c)) : cands;
  const periods = league.rosterPeriods.filter((p) => p.number >= targetNumber).slice(0, STREAM_DAYS);
  const perWeek = config.features.claimsPerWeek;
  const resetDay = addDays(claimWeekStart(nowMs, config.cadence.claimWeekStartsOn ?? 1), 7);
  const currentClaims = plan.waivers.claimsLeft ?? perWeek;
  const days: StreamDay[] = periods.map((p) => ({
    number: p.number,
    date: torontoDate(Date.parse(p.start)),
    candidates: withLocks(rosterCandidates(ctx, roster, p.number), p.number),
    canClaim: (id) => pickupAvailable(ctx, id, p.number, nowMs),
    poolCandidate: (id) => {
      if (!pickupAvailable(ctx, id, p.number, nowMs)) return null;
      const c = candidateFor(ctx, id, waiverSet.has(id) ? "WW" : "FA", undefined, p.number);
      return c && Object.values(c.values).some((v) => (v ?? 0) > 0) ? c : null;
    },
    wwUsable: torontoDate(Date.parse(p.start)) > todayEt,
    capKey: scoringPeriodAt(league.scoringPeriods, Date.parse(p.start))?.number ?? -1,
    ...(currentClaims === null ? {} : {
      claimsAvailable: config.cadence.claimWeekStartsOn != null && torontoDate(Date.parse(p.start)) >= resetDay ? perWeek! : currentClaims,
      claimWeek: config.cadence.claimWeekStartsOn != null ? claimWeekStart(Date.parse(p.start), config.cadence.claimWeekStartsOn) : "current",
    }),
  }));
  if (!days.length) return null;

  // Claims: those left this claim week, and a fresh week's once the days cross its reset.
  const crossesReset = perWeek !== null && config.cadence.claimWeekStartsOn != null && days.some((d) => d.date >= resetDay);
  const claimsAvailable = perWeek === null ? null : (plan.waivers.claimsLeft ?? perWeek) + (crossesReset ? perWeek : 0);

  // The best free agents of each position over the days.
  const shortlist = new Set<string>();
  const gamesIn = (team: string) => periods.filter((p) => index.byPeriod.get(p.number)?.has(team)).length;
  for (const g of config.eligibility.groups) {
    availableProjected(state, values)
      .filter((id) => eligibleGroups(values.players[id]!.e, config).includes(g))
      .filter((id) => !isRuledOut({ team: values.players[id]!.t, icons: state.icons[id] ?? [] }))
      .map((id) => ({ id, v: bestFpg(values.players[id]!, config) * gamesIn(values.players[id]!.t) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, STREAM_POOL_PER_GROUP)
      .forEach((x) => shortlist.add(x.id));
  }

  const rosCaps = new Map(
    league.scoringPeriods.filter((p) => p.gpMax != null || p.gsMax != null).map((p) => [p.number, { gpMax: p.gpMax ?? null, gsMax: p.gsMax ?? null }] as const),
  );
  const spNumber = plan.scoringPeriod?.number;
  const result = planStreamers(
    days,
    [...shortlist].map((id) => ({ id, status: waiverSet.has(id) ? ("WW" as const) : ("FA" as const) })),
    {
      slotCounts: league.slotCounts,
      slotOrder: config.slots.order,
      needsDrop: si.needsDrop,
      drops: si.drops,
      maxClaims: claimsAvailable ?? STREAM_CLAIMS_UNLIMITED,
      minGain: si.minGain,
      capOf: (key): WaiverCap | null => {
        if (!config.features.gamesCaps) return null;
        if (key === spNumber) return si.cap;
        const c = rosCaps.get(key);
        return c ? { ...c, gpUsed: 0, gsUsed: 0 } : null;
      },
    },
  );
  if (!result) return null;
  return {
    days: days.map((d) => d.date),
    steps: result.steps.map((s) => ({
      id: s.id,
      status: s.status,
      from: s.from,
      to: s.to,
      games: round(s.games),
      gain: round(s.gain),
      drop: s.drop ? { id: s.drop.id, action: s.drop.action } : null,
    })),
    gain: round(result.gain),
    gainUncapped: round(result.gainUncapped),
    capLimited: result.capLimited,
    claimsAvailable,
  };
}
