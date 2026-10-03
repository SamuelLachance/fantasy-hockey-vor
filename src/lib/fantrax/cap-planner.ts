/**
 * Games-cap planner: which of tonight's players to bench so the period's GP
 * (skaters) / GS (goalies) caps are spent on the best games, solved as a
 * small stochastic dynamic program over the days left in the scoring period.
 *
 * Fantrax rule (Captains: 52 GP / 8 GS a week, ACTIVE slots only): points
 * count while the counter is below the cap at the start of a day; the day it
 * is crossed counts in full, nothing after it. So the problem is not only
 * « use the games on the best players » (what one per-game bar for the whole
 * period does) but also « when to cross »: 50 games used, a 13-game night
 * counts all 13.
 *
 * Model, per group (skaters, goalies — separate counters and seats):
 *  - a day's options are bench bars: everyone under the bar (points per
 *    expected game) sits, the rest of the lineup is re-solved
 *    (`optimizeLineup`), giving the day's expected points and a law of its
 *    games (independent Bernoulli(games_i): P(play), P(start));
 *  - state = games used (integer, 0..cap; the cap is absorbing), Bellman
 *    backward from the period's last day: W_t(u) = max_bar V_t + E W_{t+1}(u + J).
 * Only tonight's bar is used: tomorrow is re-planned on the real counter.
 *
 * Measured by `scripts/backtest-mgmt.ts` (NHL seasons replayed game by game
 * for simulated Captains rosters); `scripts/test-cap-planner.ts` keeps it
 * honest on a seeded synthetic season.
 */
import { SLOT_ORDER, type SlotCounts, type SlotId } from "./config";
import { optimizeLineup, type LineupCandidate } from "./lineup";
import type { WaiverCap } from "./waivers";

export interface CapPlan {
  /** Bench tonight's skaters (goalies) below this per-game value; null = nobody. */
  skater: number | null;
  goalie: number | null;
  /** Expected counted points the plan adds over starting everyone, rest of the period. */
  gain: number;
}

/** Smallest expected gain (points over the period) worth benching anyone for. */
export const CAP_PLAN_MIN_GAIN = 0.5;

const isGoalie = (c: LineupCandidate) => c.values.G !== undefined;

/**
 * Per-game value of a candidate: his best seat's value over his expected
 * games that day (the captain seat included). The bench bar compares this.
 */
export function perGameValue(c: LineupCandidate): number {
  const g = c.games ?? 0;
  if (!(g > 0)) return 0;
  const goalie = isGoalie(c);
  let best = 0;
  for (const [slot, v] of Object.entries(c.values)) if ((slot === "G") === goalie) best = Math.max(best, v ?? 0);
  return best / g;
}

/** The day's candidates with one group's players under `bar` benched: out of every seat (locked players stay). */
export function benchBelow(cands: LineupCandidate[], goalie: boolean, bar: number | null): LineupCandidate[] {
  if (bar === null) return cands;
  return cands.map((c) => (!c.locked && isGoalie(c) === goalie && perGameValue(c) < bar ? { ...c, eligible: [], values: {}, games: 0 } : c));
}

interface Option {
  bar: number | null;
  value: number;
  /** Law of the group's games that day (index = games). */
  law: number[];
}

function bernoulliLaw(ps: number[]): number[] {
  let law = [1];
  for (const p of ps) {
    const next = new Array<number>(law.length + 1).fill(0);
    for (let j = 0; j < law.length; j++) {
      next[j]! += law[j]! * (1 - p);
      next[j + 1]! += law[j]! * p;
    }
    law = next;
  }
  return law;
}

/** One group's options on one day: no bench, then a bar just above each player's per-game value. */
function dayOptions(cands: LineupCandidate[], slots: SlotCounts, order: readonly SlotId[], goalie: boolean): Option[] {
  const values = [...new Set(cands.filter((c) => isGoalie(c) === goalie && !c.locked).map(perGameValue).filter((v) => v > 0))].sort((a, b) => a - b);
  const bars: Array<number | null> = [null, ...values.map((v) => v + 1e-9)];
  const out: Option[] = [];
  const seen = new Set<string>();
  for (const bar of bars) {
    const day = benchBelow(cands, goalie, bar);
    const res = optimizeLineup(day, slots, order);
    const byId = new Map(day.map((c) => [c.id, c]));
    let value = 0;
    const ps: number[] = [];
    const ids: string[] = [];
    for (const a of res.assignments) {
      const c = a.playerId ? byId.get(a.playerId) : undefined;
      if (!c || isGoalie(c) !== goalie) continue;
      value += Math.max(0, a.value);
      const g = Math.min(1, Math.max(0, c.games ?? (a.value > 0 ? 1 : 0)));
      if (g > 0) {
        ps.push(g);
        ids.push(c.id);
      }
    }
    const key = ids.sort().join();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ bar, value, law: bernoulliLaw(ps) });
  }
  return out;
}

interface GroupPlan {
  bar: number | null;
  /** Expected counted points: the plan, and starting everyone every day. */
  planned: number;
  allIn: number;
}

function planGroup(days: LineupCandidate[][], slots: SlotCounts, order: readonly SlotId[], goalie: boolean, room: number): GroupPlan | null {
  if (!(room > 0) || days.length === 0) return null;
  const cap = Math.max(1, Math.round(room));
  const opts = days.map((cands) => dayOptions(cands, slots, order, goalie));
  const expectNext = (law: number[], u: number, F: Float64Array) => {
    let e = 0;
    for (let j = 0; j < law.length; j++) e += law[j]! * F[Math.min(cap, u + j)]!;
    return e;
  };
  // Backward induction; W[u] for u = 0..cap (cap: reached, nothing counts).
  let W = new Float64Array(cap + 1);
  let A = new Float64Array(cap + 1);
  let first: Option | null = null;
  for (let t = days.length - 1; t >= 0; t--) {
    const o = opts[t]!;
    const W2 = new Float64Array(cap + 1);
    const A2 = new Float64Array(cap + 1);
    for (let u = 0; u < cap; u++) {
      let best = Number.NEGATIVE_INFINITY;
      let pick: Option | null = null;
      // No bench first: a bar must gain to be chosen.
      for (const x of o) {
        const v = x.value + expectNext(x.law, u, W);
        if (v > best + 1e-9) {
          best = v;
          pick = x;
        }
      }
      W2[u] = best;
      A2[u] = o[0]!.value + expectNext(o[0]!.law, u, A);
      if (t === 0 && u === 0) first = pick;
    }
    W = W2;
    A = A2;
  }
  return { bar: first?.bar ?? null, planned: W[0]!, allIn: A[0]! };
}

/**
 * Tonight's bench bars under the period's games caps. `days[0]` is tonight
 * (the lineup to set), the rest the period's later days; `cap` carries what is
 * already used before tonight. Null when the plan does not gain
 * `minGain` over starting everyone.
 */
export function capDayPlan(
  days: LineupCandidate[][],
  slots: SlotCounts,
  slotOrder: readonly SlotId[] = SLOT_ORDER,
  cap: WaiverCap,
  minGain = CAP_PLAN_MIN_GAIN,
): CapPlan | null {
  const sk = cap.gpMax === null ? null : planGroup(days, slots, slotOrder, false, cap.gpMax - cap.gpUsed);
  const gl = cap.gsMax === null ? null : planGroup(days, slots, slotOrder, true, cap.gsMax - cap.gsUsed);
  const gain = (sk ? sk.planned - sk.allIn : 0) + (gl ? gl.planned - gl.allIn : 0);
  if (!(gain >= minGain)) return null;
  // 4 decimals, rounded up: the bar stays above the last benched player.
  const up = (g: GroupPlan | null) => (g && g.bar !== null ? Math.ceil(g.bar * 1e4) / 1e4 : null);
  return { skater: up(sk), goalie: up(gl), gain };
}
