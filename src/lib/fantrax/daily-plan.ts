/**
 * Composes the daily view for one team from the baked snapshot: roster
 * legality, the optimal lineup for the next lineup period (captain
 * included), goalie start odds, games-cap usage, games left this scoring
 * period, waiver targets and the draft outlook.
 *
 * One pure function feeds the CLI report, the sync's `today.json` and the
 * /league page (which re-runs it in the browser on live fxea rosters).
 * Output carries codes and numbers, never prose, so each surface words it
 * in its own language.
 */
import {
  CAPTAINS_DYNASTY,
  DROP_PROTECT_ANY_AGE_MIN_ROS,
  DROP_PROTECT_MAX_AGE,
  DROP_PROTECT_MIN_ROS,
  DROP_PROTECT_TOP_N,
  eligibleGroups,
  FANTRAX_ICON,
  waiverMinDelta,
  type FantraxLeagueConfig,
  type SlotId,
} from "./config";
import {
  claimWeekStart,
  rosterPeriodsIn,
  scoringPeriodAt,
  targetRosterPeriod,
  torontoDate,
  type IsoPeriod,
} from "./dates";
import { draftOutlook, type DraftOutlook } from "./draft";
import {
  availableProjected,
  bestFpg,
  draftIsOpen,
  draftNeed,
  draftPoolInputs,
  isGoalieRecord,
  planOdds,
  seasonFp,
} from "./draft-inputs";
import {
  bestNonCaptainValue,
  captainGain,
  captainRanking,
  eligibleSlots,
  optimizeLineup,
  totalWithCaptain,
  type LineupCandidate,
  type LineupMove,
  type LineupResult,
} from "./lineup";
import { backToBackShares, dayToDayFactor, isRuledOut, skaterPlayProbability } from "./points-model";
import {
  deadReason,
  evaluateRoster,
  irEligible,
  type RosterEntry,
  type RosterEvaluation,
} from "./roster-rules";
import { skaterSlotValue } from "./scoring";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "./snapshot-types";
import { waiverTargets, type DropOption, type WaiverCap, type WaiverDay, type WaiverTarget } from "./waivers";
import type { ContractsFile, SalaryUsage, salaryUsage } from "./salary-cap";

// Shared with the browser's player table (see draft-inputs.ts).
export {
  availableProjected,
  bestFpg,
  draftIsOpen,
  draftNeed,
  draftPoolInputs,
  PLAN_ODDS_EPS,
  planOdds,
  seasonFp,
} from "./draft-inputs";

export interface PlanInputs {
  league: LeagueSnapshot;
  state: StateSnapshot;
  values: ValuesSnapshot;
  schedule: ScheduleSnapshot;
  teamId: string;
  nowMs: number;
  /**
   * Season points over the replacement level of each position, by Fantrax id
   * (`leagueVor`), for a league whose slots all score a skater alike. It is
   * what the draft board ranks by; without it the board falls back to season
   * points with the empty-slot bonus. Passed in rather than computed here so
   * this module stays a pure function of its inputs, and so the model is not
   * bundled into every tab that only reads the plan.
   */
  vor?: ReadonlyMap<string, number> | null;
  /**
   * The league's config (slot table, eligibility, claim limit, features).
   * The Captains league by default, so the browser — which re-runs this on
   * the one snapshot it loaded — keeps working unchanged.
   */
  config?: FantraxLeagueConfig;
  /**
   * A salary-cap league's contracts (`<public>/contracts.json`): the plan then
   * carries the team's cap use (`salary`). Ignored for a league without a cap.
   */
  contracts?: ContractsFile | null;
  /**
   * The rules only some leagues have (`plan-kit.ts`: salary cap, per-game
   * locks). Required when `needsPlanKit(config)`: the browser loads it on
   * demand, so the planner's chunk carries none of it.
   */
  kit?: PlanKit | null;
  /**
   * Later lineup days sampled for the waiver targets' rest-of-season gain
   * (`WAIVER_ROS_SAMPLE_DAYS`, every day, by default; 0 = none).
   */
  waiverRosSampleDays?: number;
}

/** A league's own planner rules, kept out of this module (`plan-kit.ts`, `PLAN_KIT`). */
export interface PlanKit {
  salaryUsage: typeof salaryUsage;
  gameLockTarget<P extends IsoPeriod>(periods: P[], index: ScheduleIndex, nowMs: number, minutesBefore: number): P | null;
  gameLocks(a: {
    roster: readonly RosterEntry[];
    values: ValuesSnapshot;
    index: ScheduleIndex;
    target: { number: number } | null;
    nowMs: number;
    minutesBefore: number;
  }): { lockedIds: Set<string>; locks: NonNullable<DailyPlan["locks"]> };
}

/** The league has a rule only `plan-kit.ts` knows: a salary cap, or a lock on each player's own game. */
export function needsPlanKit(config: FantraxLeagueConfig): boolean {
  return !!config.salaryCap || config.cadence.lock?.kind === "game";
}

function requireKit(kit: PlanKit | null | undefined, config: FantraxLeagueConfig): PlanKit {
  if (!kit) throw new Error(`${config.slug}: its salary cap / per-game locks need the plan kit (pass PLAN_KIT from plan-kit.ts)`);
  return kit;
}

export interface TeamGame {
  startUTC: string;
  opp: string;
  home: boolean;
}

export type AlertCode =
  | "illegal-roster"
  | "roster-limit"
  | "empty-slot"
  | "dead-active"
  | "healthy-ir"
  | "over-max-after-moves"
  | "fxpa-down"
  /** This league never exposes the injury / minors / caps details (fxpa closed). */
  | "fxpa-closed"
  | "stale-data"
  /** Salary-cap league: the counted players' cap hits pass the league cap. */
  | "salary-over";

/**
 * Where a dead active player should go. Reserve keeps him counted toward
 * the 15-player minimum; Minors / IR free a counted spot and are only
 * advised when the roster stays legal without him. Null: no room anywhere,
 * replace or drop him.
 */
export type DeadMove = "RESERVE" | "MINORS" | "INJURED_RESERVE" | null;

export interface PlanAlert {
  level: "error" | "warn" | "info";
  code: AlertCode;
  ids?: string[];
  slot?: SlotId;
  count?: number;
  limit?: number;
  detail?: string;
  /** dead-active: where to move him. */
  to?: DeadMove;
}

export interface PlanLineup {
  slots: Array<{ slot: SlotId; id: string | null; value: number; game: TeamGame | null }>;
  total: number;
  captain: LineupResult["captain"];
  moves: LineupMove[];
}

export interface PlanPlayer {
  n: string;
  t: string;
  e: string;
  /** Roster status on this team, or FA / WW. */
  st: string;
  /** Best per-game value outside the captain slot. */
  fpg: number;
  src: "proj" | "prior";
  age?: number;
  ros?: number;
  icons?: string[];
}

export interface DailyPlan {
  generatedAt: string;
  dataAsOf: string;
  teamId: string;
  teamName: string;
  fxpaOk: boolean;
  target: { rosterPeriod: number; start: string; end: string; date: string } | null;
  /**
   * A league where each player locks `minutesBefore` his own game (absent
   * elsewhere): `next` is the earliest lock still ahead among this team's
   * players who play in the target period (else that period's last lock,
   * when the plan moves to the next day); `locked` are the rostered players
   * whose game has locked, held where they are by the optimizer.
   */
  locks?: { minutesBefore: number; next: string | null; last: string | null; locked: string[] };
  scoringPeriod: {
    number: number;
    start: string;
    end: string;
    /** Eastern dates of its first and last lineup days (Fantrax's own labels). */
    firstDay: string;
    lastDay: string;
    gpMax: number | null;
    gsMax: number | null;
    daysLeft: number;
  } | null;
  legality: RosterEvaluation & {
    /** Playable Minors / healthy-IR players to move into the counted roster. */
    fixes: string[];
    /** Where each fix goes: Active when tonight's lineup uses him, else Reserve. */
    fixTo: Record<string, "ACTIVE" | "RESERVE">;
    /** Non-playable Minors / IR players parked in Reserve: they count, they won't score. */
    reserveFills: string[];
    /** Where each dead active player should go (same after-moves count as the fixes). */
    deadMoves: Record<string, DeadMove>;
    /** Players still missing after every possible Minors/IR move. */
    shortBy: number;
  };
  alerts: PlanAlert[];
  /** Best lineup for the next lineup period (the one that locks next). */
  lineup: PlanLineup | null;
  /** Best lineup on per-game value, ignoring who plays tonight. */
  baseLineup: PlanLineup;
  /** Captain choices by the per-game lineup total each one allows (best first). */
  captains: Array<{ id: string; total: number; delta: number; gain: number; value: number }>;
  /**
   * Whoever sits in the Skt slot now: his isolated gain, and the per-game
   * lineup total with him as captain minus the optimal total (≤ 0).
   */
  currentCaptain: { id: string; gain: number; delta: number } | null;
  goalies: Array<{ id: string; pStart: number; perStart: number; value: number; b2b: boolean; game: TeamGame | null }>;
  cap: {
    gp: number;
    gpMax: number | null;
    gs: number;
    gsMax: number | null;
    projectedGp: number;
    projectedGs: number;
    /**
     * The projection reaches the cap at the start of a remaining lineup day
     * (the only case that costs points: the day it is crossed counts in full).
     */
    gpBinds: boolean;
    gsBinds: boolean;
    known: boolean;
  } | null;
  week: { days: string[]; rows: Array<{ id: string; games: number[]; total: number }> } | null;
  waivers: {
    /** Monday (Eastern) the claim counter last reset. */
    weekStart: string;
    claimsUsed: number | null;
    claimsLeft: number | null;
    targets: WaiverTarget[];
    /** Smallest gain over the rest of the period shown (this league's points and period length). */
    minDelta: number;
    /** The period's GP / GS cap binds: gains count only until it is reached. */
    capLimited: boolean;
  };
  draft: (Omit<DraftOutlook, "remaining"> & { remaining: number[] }) | null;
  /**
   * Salary-cap leagues only (absent elsewhere): the team's cap use over its
   * counted players (Active + Reserve), this season and the next ones; null
   * when the contracts file was not available.
   */
  salary?: SalaryUsage | null;
  players: Record<string, PlanPlayer>;
}

// ------------------------------------------------------------ schedule

export interface ScheduleIndex {
  /** Roster period number → team → game that period. */
  byPeriod: Map<number, Map<string, TeamGame>>;
  /** Team → sorted game start times (ms). */
  starts: Map<string, number[]>;
}

export function indexSchedule(schedule: ScheduleSnapshot, rosterPeriods: IsoPeriod[]): ScheduleIndex {
  const byPeriod = new Map<number, Map<string, TeamGame>>();
  const starts = new Map<string, number[]>();
  const bounds = rosterPeriods.map((p) => [Date.parse(p.start), Date.parse(p.end), p.number] as const);
  for (const [startUTC, away, home] of schedule.games) {
    const t = Date.parse(startUTC);
    // Binary search: last period starting at or before the game.
    let lo = 0;
    let hi = bounds.length - 1;
    let hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bounds[mid]![0] <= t) {
        hit = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (hit >= 0 && t <= bounds[hit]![1]) {
      const n = bounds[hit]![2];
      const m = byPeriod.get(n) ?? new Map<string, TeamGame>();
      m.set(away, { startUTC, opp: home, home: false });
      m.set(home, { startUTC, opp: away, home: true });
      byPeriod.set(n, m);
    }
    for (const team of [away, home]) {
      const list = starts.get(team) ?? [];
      list.push(t);
      starts.set(team, list);
    }
  }
  for (const list of starts.values()) list.sort((a, b) => a - b);
  return { byPeriod, starts };
}

/**
 * The lineup period to set now. Period lock (Captains): the first period
 * whose start, its first puck drop, is ahead. Game lock (Slapshot: each
 * player locks `minutesBefore` his own game): the first period whose last
 * game has not locked, so today's lineup stays the target all evening.
 */
export function lineupTarget<P extends IsoPeriod>(
  periods: P[],
  index: ScheduleIndex,
  nowMs: number,
  config: FantraxLeagueConfig,
  kit?: PlanKit | null,
): P | null {
  const lock = config.cadence.lock;
  if (lock?.kind !== "game") return targetRosterPeriod(periods, nowMs);
  return requireKit(kit, config).gameLockTarget(periods, index, nowMs, lock.minutesBefore);
}

// ------------------------------------------------------------ values

interface Ctx {
  league: LeagueSnapshot;
  state: StateSnapshot;
  values: ValuesSnapshot;
  index: ScheduleIndex;
  teamGoalies: Map<string, string[]>;
  config: FantraxLeagueConfig;
}

function goalieShareForPeriod(ctx: Ctx, id: string, period: number | null): { p: number; b2b: boolean } {
  const rec = ctx.values.players[id];
  if (!rec) return { p: 0, b2b: false };
  const base = rec.pS ?? 0;
  if (period === null) return { p: base, b2b: false };
  const today = ctx.index.byPeriod.get(period);
  if (!today?.has(rec.t)) return { p: 0, b2b: false };
  const yesterday = ctx.index.byPeriod.get(period - 1);
  if (!yesterday?.has(rec.t)) return { p: base, b2b: false };
  const mates = ctx.teamGoalies.get(rec.t) ?? [id];
  const shares = new Map(mates.map((g) => [g, ctx.values.players[g]?.pS ?? 0]));
  return { p: backToBackShares(shares).get(id) ?? base, b2b: true };
}

/**
 * Lineup candidate for one lineup period (`period` null = per-game value,
 * schedule ignored). Returns null for players who can't score that period.
 */
function candidateFor(
  ctx: Ctx,
  id: string,
  status: string,
  currentSlot: string | undefined,
  period: number | null,
): LineupCandidate | null {
  const rec = ctx.values.players[id];
  if (!rec) return null;
  const icons = ctx.state.icons[id] ?? [];
  const eligible = eligibleSlots(rec.e, ctx.config);
  const values: Partial<Record<SlotId, number>> = {};
  if (isGoalieRecord(rec)) {
    const out = isRuledOut({ team: rec.t, icons });
    const { p } = out ? { p: 0 } : goalieShareForPeriod(ctx, id, period);
    const start = p * dayToDayFactor(icons);
    values.G = start * (rec.gE ?? 0);
    return { id, eligible, status, currentSlot, values, games: start };
  } else {
    const hasGame = period === null ? true : !!ctx.index.byPeriod.get(period)?.has(rec.t);
    const p = skaterPlayProbability(
      { gp: rec.gp, fpg: bestFpg(rec), src: rec.src, team: rec.t, icons },
      hasGame,
      ctx.config.priors,
    );
    const isD = eligible.includes("D");
    for (const s of eligible) {
      if (s === "G") continue;
      values[s] = p * skaterSlotValue(rec.off ?? 0, rec.dx ?? 0, s, ctx.league.sktMultiplier, { isD });
    }
    return { id, eligible, status, currentSlot, values, games: p };
  }
}

/**
 * ACTIVE, RESERVE, and IR / Minors players who can dress (healthy, or
 * day-to-day); IR and Minors only when they score that period.
 */
function rosterCandidates(ctx: Ctx, roster: RosterEntry[], period: number | null): LineupCandidate[] {
  const out: LineupCandidate[] = [];
  for (const r of roster) {
    const flags = { icons: ctx.state.icons[r.id], team: ctx.values.players[r.id]?.t };
    if ((r.status === "INJURED_RESERVE" || r.status === "MINORS") && deadReason(flags)) continue;
    // Without fxpa icons nobody in Minors / on IR is known to be playable.
    if (!ctx.state.fxpaOk && (r.status === "MINORS" || r.status === "INJURED_RESERVE")) continue;
    const c = candidateFor(ctx, r.id, r.status, r.status === "ACTIVE" ? r.slot : undefined, period);
    if (!c) continue;
    const scores = Object.values(c.values).some((v) => (v ?? 0) > 0);
    if (r.status !== "ACTIVE" && r.status !== "RESERVE" && !scores) continue;
    out.push(c);
  }
  return out;
}

function toPlanLineup(res: LineupResult, ctx: Ctx, period: number | null): PlanLineup {
  const games = period === null ? null : ctx.index.byPeriod.get(period);
  return {
    slots: res.assignments.map((a) => ({
      slot: a.slot,
      id: a.playerId,
      value: round(a.value),
      game: a.playerId && games ? (games.get(ctx.values.players[a.playerId]?.t ?? "") ?? null) : null,
    })),
    total: round(res.total),
    captain: res.captain
      ? { ...res.captain, value: round(res.captain.value), gain: round(res.captain.gain) }
      : null,
    moves: res.moves,
  };
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

const WAIVER_TARGETS_PER_GROUP = 3;
/**
 * Later lineup days a waiver target's rest-of-season gain is solved on: all
 * of them. A sample is not good enough — 24 evenly spaced days missed the
 * full day-by-day replay by a median 22 points on Captains' targets (Sean
 * Durzi: -4.9 sampled, +25.7 in full, +25.8 by replaying the whole plan
 * every day), because who plays which night is the whole effect. Solving
 * only the nights the pickup plays keeps a plan near 0.2 s.
 */
export const WAIVER_ROS_SAMPLE_DAYS = Number.POSITIVE_INFINITY;

/**
 * Lineup periods after scoring period `sp` through the end of the fantasy
 * regular season (the playoffs left out).
 */
function rosRosterPeriods(league: LeagueSnapshot, sp: IsoPeriod & { number: number }): Array<IsoPeriod & { number: number }> {
  const firstPlayoff = league.playoffs?.firstPeriod ?? Number.POSITIVE_INFINITY;
  const regular = league.scoringPeriods.filter((p) => p.number < firstPlayoff);
  const last = regular[regular.length - 1];
  if (!last) return [];
  const from = Date.parse(sp.end);
  const to = Date.parse(last.end);
  return league.rosterPeriods.filter((p) => Date.parse(p.start) > from && Date.parse(p.start) <= to);
}

/** One display group per player: G, then D, then C, then W. */
function waiverGroup(eligiblePos: string): string {
  const t = eligiblePos.split(",");
  return ["G", "D", "C", "W"].find((g) => t.includes(g)) ?? "W";
}

// ------------------------------------------------------------ plan

export function buildDailyPlan(input: PlanInputs): DailyPlan {
  const { league, state, values, schedule, teamId, nowMs } = input;
  const config = input.config ?? CAPTAINS_DYNASTY;
  const index = indexSchedule(schedule, league.rosterPeriods);
  const teamGoalies = new Map<string, string[]>();
  for (const [id, r] of Object.entries(values.players)) {
    if (!isGoalieRecord(r, config)) continue;
    teamGoalies.set(r.t, [...(teamGoalies.get(r.t) ?? []), id]);
  }
  const ctx: Ctx = { league, state, values, index, teamGoalies, config };
  const roster = state.rosters[teamId] ?? [];
  const onRoster = new Map(roster.map((r) => [r.id, r]));
  const slotCounts = league.slotCounts;
  const slotOrder = config.slots.order;

  // The lineup to set is the next one to lock; its scoring period is the
  // one whose caps and waiver window matter.
  const target = lineupTarget(league.rosterPeriods, index, nowMs, config, input.kit);
  const sp = scoringPeriodAt(league.scoringPeriods, target ? Date.parse(target.start) : nowMs);
  const periodDays =
    sp && target
      ? rosterPeriodsIn(league.rosterPeriods, sp).filter((p) => p.number >= target.number)
      : [];

  // ---- legality
  const flags = Object.fromEntries(
    roster.map((r) => [r.id, { icons: state.icons[r.id] ?? [], team: values.players[r.id]?.t }]),
  );
  const evaluation = evaluateRoster(roster, flags, {
    limits: league.limits,
    slotCounts,
    slotOrder,
    iconsKnown: state.fxpaOk,
  });

  // ---- per-game (schedule-free) lineup
  const baseCands = rosterCandidates(ctx, roster, null);
  const baseRes = optimizeLineup(baseCands, slotCounts, slotOrder);
  const baseLineup = toPlanLineup(baseRes, ctx, null);
  // Captains are ranked by the whole per-game lineup each one allows, so the
  // advice always agrees with the optimizer's Skt pick.
  const captains = captainRanking(baseCands, 5, slotCounts, slotOrder).map((c) => ({
    id: c.id,
    total: round(c.total),
    delta: round(c.delta),
    gain: round(c.gain),
    value: round(c.value),
  }));
  const sittingCaptain = roster.find((r) => r.status === "ACTIVE" && r.slot === "Skt");
  const sittingCand = sittingCaptain ? baseCands.find((c) => c.id === sittingCaptain.id) : undefined;
  const currentCaptain = sittingCaptain
    ? {
        id: sittingCaptain.id,
        gain: round(sittingCand ? captainGain(sittingCand) : 0),
        delta: round(Math.min(0, totalWithCaptain(baseCands, sittingCaptain.id, slotCounts, slotOrder) - baseRes.total)),
      }
    : null;

  // ---- per-game locks (a league where each player locks on his own game):
  // whoever's game in the target period has locked stays where he is.
  const gameLock = config.cadence.lock?.kind === "game" ? config.cadence.lock : null;
  const held = gameLock
    ? requireKit(input.kit, config).gameLocks({ roster, values, index, target, nowMs, minutesBefore: gameLock.minutesBefore })
    : null;
  const lockedIds = held?.lockedIds ?? new Set<string>();
  const withLocks = (cands: LineupCandidate[], period: number) =>
    lockedIds.size && period === target?.number
      ? cands.map((c) => (lockedIds.has(c.id) ? { ...c, locked: true } : c))
      : cands;
  const locks = held?.locks;

  // ---- tonight
  const tonightCands = target ? withLocks(rosterCandidates(ctx, roster, target.number), target.number) : [];
  const tonightRes = target ? optimizeLineup(tonightCands, slotCounts, slotOrder) : null;
  const lineup = tonightRes && target ? toPlanLineup(tonightRes, ctx, target.number) : null;

  // ---- legality moves
  // One after-moves count drives every piece of advice: playable Minors /
  // healthy-IR players first (those tonight's or the per-game lineup uses,
  // then by per-game value); then any other Minors (then injured IR) player
  // parked in Reserve, since the 15-player minimum counts bodies, not
  // scorers, and moving out of Minors is never blocked; only then is the
  // team truly short. Dead active players go to Minors / IR only when the
  // roster stays legal without them, otherwise to Reserve (still counted).
  const limits = league.limits;
  const promotable = [
    ...evaluation.movableFromMinors,
    ...evaluation.healthyOnIr,
  ].filter((id) => values.players[id]);
  const placed = (res: LineupResult | null) =>
    new Set((res?.assignments ?? []).filter((a) => a.value > 0).map((a) => a.playerId));
  const inTonight = placed(tonightRes);
  const inBase = placed(baseRes);
  const rank = (id: string) => (inTonight.has(id) ? 2 : 0) + (inBase.has(id) ? 1 : 0);
  // Expected per-game value (P(play) included), so a 3-GP placeholder
  // projection does not jump a nightly regular.
  const baseById = new Map(baseCands.map((c) => [c.id, c]));
  const expected = (id: string) => {
    const c = baseById.get(id);
    return c ? bestNonCaptainValue(c) : 0;
  };
  const fixes = promotable
    .sort((a, b) => rank(b) - rank(a) || expected(b) - expected(a) || bestFpg(values.players[b]!, config) - bestFpg(values.players[a]!, config))
    .slice(0, evaluation.need);
  let reserveRoom = Math.max(0, limits.maxReserve - evaluation.counts.reserve);
  const fixTo: Record<string, "ACTIVE" | "RESERVE"> = {};
  for (const id of fixes) {
    // Active room always covers the shortfall (Active max = the minimum).
    const toActive = (tonightRes ? inTonight.has(id) : inBase.has(id)) || reserveRoom === 0;
    fixTo[id] = toActive ? "ACTIVE" : "RESERVE";
    if (!toActive) reserveRoom--;
  }
  const fixSet = new Set(fixes);
  const minorsEligible = new Set(state.minorsEligible);
  // A league whose Minors take anyone (Slapshot) needs no eligibility flag.
  const canReturnToMinors = (id: string) =>
    config.features.minorsAnyPlayer ||
    minorsEligible.has(id) ||
    (state.icons[id] ?? []).includes(FANTRAX_ICON.minorsEligible);
  // Reserve bodies: Minors players who can go back down later first, then
  // by per-game value (the likeliest to be playing soon). The count needs no
  // icons, so this works even when fxpa was down.
  const bodyScore = (id: string) => (canReturnToMinors(id) ? 1000 : 0) + (values.players[id] ? bestFpg(values.players[id]!, config) : 0);
  const bodies = (status: string) =>
    roster
      .filter((r) => r.status === status && !fixSet.has(r.id))
      .map((r) => r.id)
      .sort((a, b) => bodyScore(b) - bodyScore(a));
  const reserveFills = [...bodies("MINORS"), ...bodies("INJURED_RESERVE")].slice(
    0,
    Math.min(Math.max(0, evaluation.need - fixes.length), reserveRoom),
  );
  reserveRoom -= reserveFills.length;
  const shortBy = Math.max(0, evaluation.need - fixes.length - reserveFills.length);
  const fromStatus = (ids: string[], status: string) => ids.filter((id) => onRoster.get(id)?.status === status).length;
  let minorsCount = evaluation.counts.minors - fromStatus([...fixes, ...reserveFills], "MINORS");
  let irCount = evaluation.counts.ir - fromStatus([...fixes, ...reserveFills], "INJURED_RESERVE");
  let surplus = evaluation.counts.counted + fixes.length + reserveFills.length - limits.minTotal;
  const deadMoves: Record<string, DeadMove> = {};
  for (const d of evaluation.dead) {
    const f = flags[d.id];
    const out: DeadMove =
      irEligible(f) && irCount < limits.maxIr
        ? "INJURED_RESERVE"
        : canReturnToMinors(d.id) && minorsCount < limits.maxMinors
          ? "MINORS"
          : null;
    if (out && surplus > 0) {
      deadMoves[d.id] = out;
      surplus--;
      if (out === "MINORS") minorsCount++;
      else irCount++;
    } else if (reserveRoom > 0) {
      deadMoves[d.id] = "RESERVE";
      reserveRoom--;
    } else deadMoves[d.id] = null;
  }
  const deadOut = Object.values(deadMoves).filter((m) => m === "MINORS" || m === "INJURED_RESERVE").length;

  // ---- goalies
  const goalieIds = roster
    .filter((r) => values.players[r.id] && isGoalieRecord(values.players[r.id]!, config))
    .filter((r) => r.status !== "MINORS" || !deadReason(flags[r.id]))
    .map((r) => r.id);
  const goalies = goalieIds.map((id) => {
    const rec = values.players[id]!;
    const icons = state.icons[id] ?? [];
    const out = isRuledOut({ team: rec.t, icons });
    const share = out || !target ? { p: 0, b2b: false } : goalieShareForPeriod(ctx, id, target.number);
    const p = share.p * dayToDayFactor(icons);
    return {
      id,
      pStart: round(p, 3),
      perStart: round(rec.gE ?? 0),
      value: round(p * (rec.gE ?? 0)),
      b2b: share.b2b,
      game: target ? (index.byPeriod.get(target.number)?.get(rec.t) ?? null) : null,
    };
  });

  // ---- daily plans across the rest of the scoring period
  const dayCands = periodDays.map((p) => withLocks(rosterCandidates(ctx, roster, p.number), p.number));
  const dayRes = dayCands.map((c) => optimizeLineup(c, slotCounts, slotOrder));

  // ---- cap monitor
  // Cap usage is as of the sync, so the projection starts at the lineup
  // period that was next to lock then (not at today's target): days played
  // since the sync are neither in `used` nor lost. A sync from before this
  // scoring period counts nothing, so the whole period is projected.
  const capUsed = state.caps[teamId];
  const sameSp = sp ? state.scoringPeriod === sp.number : false;
  const syncMs = Date.parse(state.fetchedAt);
  const syncTarget = lineupTarget(league.rosterPeriods, index, syncMs, config, input.kit);
  const spDays = sp ? rosterPeriodsIn(league.rosterPeriods, sp) : [];
  // The sync bakes the scoring period of its own target, so `sameSp` puts
  // `syncTarget` inside this period.
  const capFrom =
    sameSp && syncTarget
      ? Math.min(target?.number ?? syncTarget.number, syncTarget.number)
      : (spDays[0]?.number ?? 0);
  const capDays = spDays.filter((p) => p.number >= capFrom);
  const solved = new Map(periodDays.map((p, i) => [p.number, { cands: dayCands[i]!, res: dayRes[i]! }]));
  const gpByDay: number[] = [];
  const gsByDay: number[] = [];
  for (const p of capDays) {
    let day = solved.get(p.number);
    if (!day) {
      const cands = rosterCandidates(ctx, roster, p.number);
      day = { cands, res: optimizeLineup(cands, slotCounts, slotOrder) };
    }
    const byId = new Map(day.cands.map((c) => [c.id, c]));
    let gp = 0;
    let gs = 0;
    for (const a of day.res.assignments) {
      if (!a.playerId || a.value <= 0) continue;
      const c = byId.get(a.playerId)!;
      const rec = values.players[a.playerId]!;
      if (a.slot === "G") gs += (c.values.G ?? 0) / (rec.gE || 1);
      else {
        const perGame = skaterSlotValue(rec.off ?? 0, rec.dx ?? 0, a.slot, league.sktMultiplier, {
          isD: c.eligible.includes("D"),
        });
        gp += perGame > 0 ? a.value / perGame : 0;
      }
    }
    gpByDay.push(gp);
    gsByDay.push(gs);
  }
  const usedGp = capUsed && sameSp ? capUsed.gp : 0;
  const usedGs = capUsed && sameSp ? capUsed.gs : 0;
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  // Reached at the start of a remaining day = reached before the last one.
  const binds = (used: number, byDay: number[], max: number | null) =>
    max !== null && byDay.length > 0 && used + sum(byDay.slice(0, -1)) >= max;
  const gpMax = sp ? (sp.gpMax ?? capUsed?.gpMax ?? null) : null;
  const gsMax = sp ? (sp.gsMax ?? capUsed?.gsMax ?? null) : null;
  // No cap block for a league whose config says it has no per-period GP / GS
  // caps: an empty meter reading « 0 / ? » would suggest a rule exists and
  // that the tool simply failed to read it. Slapshot's caps are not merely
  // unread — fxpa is closed for it, so whether they exist at all is unknown,
  // and the page says nothing rather than something wrong.
  const cap = sp && config.features.gamesCaps
    ? {
        gp: usedGp,
        gpMax,
        gs: usedGs,
        gsMax,
        projectedGp: round(usedGp + sum(gpByDay), 1),
        projectedGs: round(usedGs + sum(gsByDay), 1),
        gpBinds: binds(usedGp, gpByDay, gpMax),
        gsBinds: binds(usedGs, gsByDay, gsMax),
        known: !!capUsed,
      }
    : null;

  // ---- games left grid (counted + playable Minors / healthy IR)
  const gridIds = roster
    .filter((r) => r.status === "ACTIVE" || r.status === "RESERVE" || !deadReason(flags[r.id]))
    .map((r) => r.id)
    .filter((id) => values.players[id]);
  const week = periodDays.length
    ? {
        days: periodDays.map((p) => torontoDate(Date.parse(p.start))),
        rows: gridIds.map((id) => {
          const team = values.players[id]!.t;
          const games = periodDays.map((p) => (index.byPeriod.get(p.number)?.has(team) ? 1 : 0));
          return { id, games, total: games.reduce((s: number, g) => s + g, 0) };
        }),
      }
    : null;

  // ---- waivers
  const waiverSet = new Set(state.waivers);
  const available = availableProjected(state, values);
  const todayEt = torontoDate(nowMs);
  const waiverDays: WaiverDay[] = periodDays.map((p, i) => ({
    candidates: dayCands[i]!,
    wwUsable: torontoDate(Date.parse(p.start)) > todayEt,
    poolCandidate: (id) => {
      const c = candidateFor(ctx, id, waiverSet.has(id) ? "WW" : "FA", undefined, p.number);
      return c && Object.values(c.values).some((v) => (v ?? 0) > 0) ? c : null;
    },
  }));
  // Pre-filter: the best 10 per position by value over the period.
  const potential = (id: string) => {
    const rec = values.players[id]!;
    const days = periodDays.filter((p) => index.byPeriod.get(p.number)?.has(rec.t)).length;
    return bestFpg(rec, config) * days;
  };
  const shortlist = new Set<string>();
  // The league's own group vocabulary: a fixed ["C","W","D","G"] token test
  // matched no winger at all in a league whose slots are LW and RW.
  for (const g of config.eligibility.groups) {
    available
      .filter((id) => eligibleGroups(values.players[id]!.e, config).includes(g))
      .filter((id) => !isRuledOut({ team: values.players[id]!.t, icons: state.icons[id] ?? [] }))
      .map((id) => ({ id, v: potential(id) }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 10)
      .forEach((x) => shortlist.add(x.id));
  }
  const maxCounted = league.limits.maxActive + league.limits.maxReserve;
  const promotedCount = evaluation.counts.counted + fixes.length + reserveFills.length - deadOut;
  const ranked = roster
    .filter((r) => r.status === "ACTIVE" || r.status === "RESERVE")
    .map((r) => ({ id: r.id, v: values.players[r.id] ? seasonFp(values.players[r.id]!, config) : 0 }))
    .sort((a, b) => b.v - a.v);
  const core = new Set(ranked.slice(0, DROP_PROTECT_TOP_N).map((x) => x.id));
  const drops: DropOption[] = [];
  for (const r of ranked) {
    const rec = values.players[r.id];
    if (!rec) continue;
    const eligibleForMinors = canReturnToMinors(r.id) && evaluation.counts.minors < league.limits.maxMinors;
    const ros = state.ros[r.id] ?? 0;
    const protectedAsset =
      core.has(r.id) ||
      ros >= DROP_PROTECT_ANY_AGE_MIN_ROS ||
      ((rec.age ?? 99) <= DROP_PROTECT_MAX_AGE && ros >= DROP_PROTECT_MIN_ROS);
    if (eligibleForMinors) drops.push({ id: r.id, action: "minors", fpg: bestFpg(rec, config) });
    else if (!protectedAsset) drops.push({ id: r.id, action: "drop", fpg: bestFpg(rec, config) });
  }
  // The rest of the fantasy regular season after this period, on a sample
  // of its lineup days: what an add (and the drop) does once the period ends.
  const rosPeriods = sp ? rosRosterPeriods(league, sp) : [];
  const rosSample = input.waiverRosSampleDays ?? WAIVER_ROS_SAMPLE_DAYS;
  const rosStep = Math.max(1, rosPeriods.length / Math.max(1, Math.min(rosSample, rosPeriods.length)));
  const rosDays: WaiverDay[] = [];
  for (let k = 0; k < Math.min(rosPeriods.length, rosSample); k++) {
    const p = rosPeriods[Math.min(rosPeriods.length - 1, Math.floor((k + 0.5) * rosStep))]!;
    rosDays.push({
      candidates: rosterCandidates(ctx, roster, p.number),
      wwUsable: true,
      weight: rosStep,
      poolCandidate: (id) => {
        const c = candidateFor(ctx, id, waiverSet.has(id) ? "WW" : "FA", undefined, p.number);
        return c && Object.values(c.values).some((v) => (v ?? 0) > 0) ? c : null;
      },
    });
  }
  // Games caps: the waiver days start at the target; what the lineup is
  // expected to play between the sync and the target is already used.
  const before = (byDay: number[]) =>
    sum(byDay.filter((_, i) => target !== null && capDays[i]!.number < target.number));
  const waiverCap: WaiverCap | null =
    cap && (gpMax !== null || gsMax !== null)
      ? { gpMax, gsMax, gpUsed: usedGp + before(gpByDay), gsUsed: usedGs + before(gsByDay) }
      : null;
  const minDelta = waiverMinDelta(config, sp ? rosterPeriodsIn(league.rosterPeriods, sp).length : config.cadence.scoringPeriodDays);
  const allTargets = periodDays.length
    ? waiverTargets(
        waiverDays,
        [...shortlist].map((id) => ({
          id,
          status: waiverSet.has(id) ? ("WW" as const) : ("FA" as const),
          fpg: bestFpg(values.players[id]!, config),
        })),
        {
          slotCounts,
          slotOrder,
          needsDrop: promotedCount >= maxCounted,
          drops,
          minDelta,
          rosDays,
          cap: waiverCap,
        },
      )
    : [];
  // Keep the best few per position so one deep position can't hide the rest.
  const perGroup = new Map<string, number>();
  const targets = allTargets
    .filter((t) => {
      const g = waiverGroup(values.players[t.id]!.e);
      const n = perGroup.get(g) ?? 0;
      perGroup.set(g, n + 1);
      return n < WAIVER_TARGETS_PER_GROUP;
    })
    .map((t) => ({ ...t, delta: round(t.delta, 1), fpg: round(t.fpg), ros: round(t.ros, 1) }));
  const capLimited = !!(cap?.gpBinds || cap?.gsBinds);
  // The counter resets Monday: a snapshot from an earlier claim week says
  // nothing about this one, so it starts from 0 until the next sync.
  const weekStart = claimWeekStart(nowMs, config.cadence.claimWeekStartsOn ?? 1);
  const claimsUsed = !state.claims
    ? null
    : weekStart > state.claimsWeekStart
      ? 0
      : (state.claims[teamId] ?? 0);

  // ---- draft
  let draft: DailyPlan["draft"] = null;
  if (state.draft && draftIsOpen(state)) {
    const need = draftNeed(baseLineup);
    const { pool, poolShare } = draftPoolInputs(state, values, available, config, input.vor ?? null);
    const outlook = draftOutlook(state.draft.picks, teamId, pool, need, {
      poolShare,
      groups: config.eligibility.groups,
    });
    // Odds are sure only when no other team picks before that pick of mine.
    const sureNext = outlook.picksBefore === 0;
    const sureFollowing = outlook.picksBeforeFollowing === 0;
    draft = {
      ...outlook,
      poolShare: round(outlook.poolShare, 3),
      remaining: outlook.remaining.map((p) => p.pick),
      board: outlook.board.map((b) => ({
        ...b,
        value: round(b.value, 1),
        seasonFp: round(b.seasonFp, 1),
        vona: b.vona == null ? null : round(b.vona, 1),
        available: planOdds(b.available, sureNext),
      })),
      vona: Object.fromEntries(
        Object.entries(outlook.vona).map(([g, v]) => [
          g,
          {
            ...v,
            bestP: v.bestId ? planOdds(v.bestP, sureNext) : 0,
            now: round(v.now, 1),
            laterP: v.laterId ? planOdds(v.laterP, sureFollowing) : 0,
            later: round(v.later, 1),
            vona: v.vona == null ? null : round(v.vona, 1),
          },
        ]),
      ) as DraftOutlook["vona"],
    };
  }

  // ---- alerts
  const alerts: PlanAlert[] = [];
  if (!state.fxpaOk) {
    // A league whose config says fxpa is closed is not a read to retry: say so
    // once, plainly, instead of reporting a failure the user cannot act on.
    alerts.push(
      config.features.fxpa
        ? { level: "warn", code: "fxpa-down", detail: state.fxpaError }
        : { level: "info", code: "fxpa-closed" },
    );
  }
  const ageH = (nowMs - Date.parse(state.fetchedAt)) / 3_600_000;
  if (ageH > 36) alerts.push({ level: "warn", code: "stale-data", count: Math.round(ageH) });
  for (const issue of evaluation.issues) {
    if (issue.code === "below-min") {
      alerts.push({ level: "error", code: "illegal-roster", count: issue.count, limit: issue.limit, ids: fixes });
    } else if (issue.code === "healthy-ir") {
      alerts.push({ level: issue.illegal ? "error" : "warn", code: "healthy-ir", ids: issue.ids });
    } else {
      alerts.push({
        level: "error",
        code: "roster-limit",
        detail: issue.code,
        count: issue.count,
        limit: issue.limit,
        slot: issue.slot,
      });
    }
  }
  for (const d of evaluation.dead) {
    alerts.push({
      level: "error",
      code: "dead-active",
      ids: [d.id],
      slot: d.slot as SlotId,
      detail: d.reason,
      to: deadMoves[d.id] ?? null,
    });
  }
  for (const s of slotOrder) {
    const f = evaluation.slots[s];
    if (f && f.empty > 0) alerts.push({ level: "warn", code: "empty-slot", slot: s, count: f.empty });
  }
  const promotedTonight = (tonightRes?.moves ?? []).filter((m) => m.from === "MINORS" || m.from === "INJURED_RESERVE").length;
  const afterMoves =
    evaluation.counts.counted + Math.max(promotedTonight, fixes.length + reserveFills.length) - deadOut;
  if (afterMoves > maxCounted) {
    alerts.push({ level: "warn", code: "over-max-after-moves", count: afterMoves, limit: maxCounted });
  }
  // ---- salary cap (Active + Reserve only)
  // Past the counted spots (a drafting team), the cap counts the best by
  // season points; the rest are expected in the minors.
  const salaryPart =
    config.salaryCap && input.contracts
      ? requireKit(input.kit, config).salaryUsage(roster, input.contracts, config.salaryCap, 4, (id) =>
          values.players[id] ? seasonFp(values.players[id]!, config) : 0,
        )
      : null;
  if (salaryPart?.over) {
    alerts.push({
      level: "warn",
      code: "salary-over",
      count: Math.round(salaryPart.used[0]! * 100) / 100,
      limit: salaryPart.cap[0]!,
      ids: salaryPart.top.slice(0, 3).map(([id]) => id),
    });
  }

  // ---- referenced players
  const referenced = new Set<string>([
    // Minors prospects who can't dress would only pad the page payload.
    ...roster.filter((r) => r.status !== "MINORS" || !deadReason(flags[r.id])).map((r) => r.id),
    ...reserveFills,
    ...targets.flatMap((t) => [t.id, ...(t.drop ? [t.drop.id] : [])]),
    ...(draft?.board.map((b) => b.id) ?? []),
    ...(draft
      ? Object.values(draft.vona)
          .flatMap((v) => [v.bestId, v.laterId])
          .filter((x): x is string => !!x)
      : []),
  ]);
  const players: Record<string, PlanPlayer> = {};
  for (const id of referenced) {
    const rec = values.players[id];
    if (!rec) continue;
    players[id] = {
      n: rec.n,
      t: rec.t,
      e: rec.e,
      st: onRoster.get(id)?.status ?? (waiverSet.has(id) ? "WW" : "FA"),
      fpg: round(bestFpg(rec, config)),
      src: rec.src,
      ...(rec.age !== undefined ? { age: rec.age } : {}),
      ...(state.ros[id] !== undefined ? { ros: state.ros[id] } : {}),
      ...(state.icons[id]?.length ? { icons: state.icons[id] } : {}),
    };
  }

  const teamName = league.teams.find((t) => t.id === teamId)?.name ?? teamId;
  return {
    ...(config.salaryCap ? { salary: salaryPart } : {}),
    generatedAt: new Date(nowMs).toISOString(),
    dataAsOf: state.fetchedAt,
    teamId,
    teamName,
    fxpaOk: state.fxpaOk,
    target: target
      ? { rosterPeriod: target.number, start: target.start, end: target.end, date: torontoDate(Date.parse(target.start)) }
      : null,
    ...(locks ? { locks } : {}),
    scoringPeriod: sp
      ? {
          number: sp.number,
          start: sp.start,
          end: sp.end,
          firstDay: spDays[0] ? torontoDate(Date.parse(spDays[0].start)) : torontoDate(Date.parse(sp.start)),
          lastDay: spDays.length
            ? torontoDate(Date.parse(spDays[spDays.length - 1]!.start))
            : torontoDate(Date.parse(sp.end)),
          gpMax: sp.gpMax,
          gsMax: sp.gsMax,
          daysLeft: periodDays.length,
        }
      : null,
    legality: { ...evaluation, fixes, fixTo, reserveFills, deadMoves, shortBy },
    alerts,
    lineup,
    baseLineup,
    captains,
    currentCaptain,
    goalies,
    cap,
    week,
    waivers: {
      weekStart,
      claimsUsed,
      claimsLeft:
        claimsUsed === null || config.features.claimsPerWeek === null
          ? null
          : Math.max(0, config.features.claimsPerWeek - claimsUsed),
      targets,
      minDelta,
      capLimited,
    },
    draft,
    players,
  };
}
