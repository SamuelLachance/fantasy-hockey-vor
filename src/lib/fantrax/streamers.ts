/**
 * The week's streaming plan: which free agents to pick up, on which day and
 * for how long, so the lineup scores the most over the next `days`.
 *
 * Every claim puts one player in ONE roster spot (the spot of the player let
 * go, or an open one), and a player is let go the day the next streamer comes
 * in. So the plan is a chain: from the day the first claim lands, the spot is
 * held by a succession of players, each for a stretch of days, and the
 * claims limit caps the length of the chain.
 *
 *   v(c, i) = best(R_i − d + c_i) − best(R_i)    (lineup day i, drop d, streamer c)
 *   plan    = max over (start j, stretches c_1…c_k) of Σ_stretch Σ_i v(c_t, i)
 *
 * `v` is a lineup delta, as in `waivers.ts`: a streamer only counts the
 * nights he would start, and the drop costs the nights he would have started
 * (a streamer with no game that night leaves the spot empty: v < 0). The
 * chain is solved exactly by dynamic programming over the days (a few
 * hundred lineup solves), for each of the cheapest drops; the claims-limited
 * winners are then re-scored under the games caps of each scoring period
 * (`plannedTotal`, what the games-cap planner can count), and a claim stays
 * only when it adds at least `minGain` points on top of the shorter plan.
 *
 * A waiver (WW) claim clears overnight: it can start a stretch only on a day
 * where `wwUsable`. Pure.
 */
import { SLOT_ORDER, type SlotCounts, type SlotId } from "./config";
import { optimizeLineup, type LineupCandidate } from "./lineup";
import { dayParts, plannedTotal, type DropOption, type WaiverCap } from "./waivers";

export interface StreamDay {
  /** Lineup period number. */
  number: number;
  /** Eastern date of the lineup day (YYYY-MM-DD). */
  date: string;
  /** The roster's candidates that day. */
  candidates: LineupCandidate[];
  /** A pool player's candidate that day (null = no game / out). */
  poolCandidate: (id: string) => LineupCandidate | null;
  /** A waiver claim made now has cleared by this day. */
  wwUsable: boolean;
  /** Scoring period of the day (its games cap applies to the days sharing it). */
  capKey: number;
}

export interface StreamPoolPlayer {
  id: string;
  status: "FA" | "WW";
}

export interface StreamOptions {
  slotCounts: SlotCounts;
  slotOrder?: readonly SlotId[];
  /** The counted roster is full: the first claim needs a player let go. */
  needsDrop: boolean;
  /** Players that can be let go (already filtered of the assets to keep). */
  drops: DropOption[];
  /** Claims the plan may use (the week's claims left). */
  maxClaims: number;
  /** Smallest gain, in points, that justifies one more claim. */
  minGain: number;
  /** Games caps by scoring period (`capKey`), null = none. */
  capOf?: (capKey: number) => WaiverCap | null;
  /** Cheapest drops tried (by the lineup points they cost over the days). */
  dropsTried?: number;
}

export interface StreamStep {
  id: string;
  status: "FA" | "WW";
  /** Index of the first / last lineup day the claim covers (inclusive). */
  from: number;
  to: number;
  /** Expected games (starts) he gives the lineup in the stretch. */
  games: number;
  /** Points the stretch adds to the lineup (the drop's cost spread over the stretches). */
  gain: number;
  /** The player let go for this claim: the roster's drop for the first step, the previous streamer after (null). */
  drop: DropOption | null;
}

export interface StreamPlan {
  steps: StreamStep[];
  /** Points over the days against no claim, under the games caps. */
  gain: number;
  /** The same, without the caps. */
  gainUncapped: number;
  /** A games cap bound the plan's total. */
  capLimited: boolean;
}

const NEG = Number.NEGATIVE_INFINITY;

const total = (cands: LineupCandidate[], slots: SlotCounts, order: readonly SlotId[] | undefined) =>
  optimizeLineup(cands, slots, order ?? SLOT_ORDER).total;

interface Chain {
  /** Gain without the caps. */
  gain: number;
  stretches: Array<{ id: string; from: number; to: number; gain: number }>;
}

/**
 * Best chain of exactly `k` stretches covering the days from some start j to the end,
 * where no player appears twice (letting a player go to pick him up again two
 * days later is never the plan). `banned` holds the "id|startDay" pairs a
 * branch has ruled out; a repeated player splits the problem in two, one
 * branch per occurrence, and the better valid chain wins.
 */
function bestChain(
  n: number,
  poolIds: string[],
  poolStatus: Map<string, "FA" | "WW">,
  prefix: Map<string, number[]>,
  wwUsable: boolean[],
  k: number,
  banned: ReadonlySet<string>,
  depth = 0,
): Chain | null {
  const allowed = (id: string, start: number) =>
    !banned.has(id + "|" + start) && (poolStatus.get(id) === "FA" || wwUsable[start] === true);
  // H[m][i]: best gain covering [i, n) with exactly m stretches (NEG when impossible)
  const H: number[][] = Array.from({ length: k + 1 }, () => Array(n + 1).fill(NEG));
  const pick: Array<Array<{ id: string; end: number } | null>> = Array.from({ length: k + 1 }, () => Array(n + 1).fill(null));
  H[0]![n] = 0;
  for (let m = 1; m <= k; m++) {
    for (let i = n - 1; i >= 0; i--) {
      let best = NEG;
      let arg: { id: string; end: number } | null = null;
      for (const id of poolIds) {
        if (!allowed(id, i)) continue;
        const p = prefix.get(id)!;
        for (let e = i + 1; e <= n; e++) {
          const rest = H[m - 1]![e]!;
          if (rest === NEG) continue;
          const g = p[e]! - p[i]! + rest;
          if (g > best + 1e-9) {
            best = g;
            arg = { id, end: e };
          }
        }
      }
      H[m]![i] = best;
      pick[m]![i] = arg;
    }
  }
  let best = NEG;
  let at = -1;
  for (let j = 0; j < n; j++) {
    if (H[k]![j]! > best + 1e-9) {
      best = H[k]![j]!;
      at = j;
    }
  }
  if (at < 0) return null;
  const stretches: Chain["stretches"] = [];
  let i = at;
  for (let left = k; left >= 1 && i < n; left--) {
    const a = pick[left]![i]!;
    stretches.push({ id: a.id, from: i, to: a.end - 1, gain: prefix.get(a.id)![a.end]! - prefix.get(a.id)![i]! });
    i = a.end;
  }
  const seen = new Map<string, number>();
  for (const [idx, st] of stretches.entries()) {
    const first = seen.get(st.id);
    if (first === undefined) {
      seen.set(st.id, idx);
      continue;
    }
    if (depth >= 8) return null;
    const x = bestChain(n, poolIds, poolStatus, prefix, wwUsable, k, new Set([...banned, st.id + "|" + stretches[first]!.from]), depth + 1);
    const y = bestChain(n, poolIds, poolStatus, prefix, wwUsable, k, new Set([...banned, st.id + "|" + st.from]), depth + 1);
    return !x ? y : !y ? x : y.gain > x.gain + 1e-9 ? y : x;
  }
  return { gain: best, stretches };
}

/** The best chain for each number of claims 1..maxClaims. */
function solveChains(
  n: number,
  poolIds: string[],
  poolStatus: Map<string, "FA" | "WW">,
  v: Map<string, number[]>,
  wwUsable: boolean[],
  maxClaims: number,
): Chain[] {
  // prefix[c][i] = sum of v(c, t) for t < i
  const prefix = new Map<string, number[]>();
  for (const id of poolIds) {
    const p = [0];
    for (let i = 0; i < n; i++) p.push(p[i]! + v.get(id)![i]!);
    prefix.set(id, p);
  }
  const out: Chain[] = [];
  for (let k = 1; k <= maxClaims; k++) {
    const c = bestChain(n, poolIds, poolStatus, prefix, wwUsable, k, new Set());
    if (c) out.push(c);
  }
  return out;
}

export function planStreamers(days: readonly StreamDay[], pool: readonly StreamPoolPlayer[], opts: StreamOptions): StreamPlan | null {
  const n = days.length;
  const maxClaims = Math.min(opts.maxClaims, n);
  if (n === 0 || maxClaims < 1 || pool.length === 0) return null;
  const slots = opts.slotCounts;
  const order = opts.slotOrder;
  const baseDay = days.map((d) => total(d.candidates, slots, order));
  const poolStatus = new Map(pool.map((p) => [p.id, p.status] as const));
  const wwUsable = days.map((d) => d.wwUsable);

  // The drops tried: open roster = none; else the cheapest by lineup cost over the days.
  type DropTry = { drop: DropOption | null; cost: number[] };
  const dropTries: DropTry[] = [];
  if (!opts.needsDrop) {
    dropTries.push({ drop: null, cost: days.map(() => 0) });
  } else {
    const costed = opts.drops.map((drop) => ({
      drop,
      cost: days.map((d, i) => baseDay[i]! - total(d.candidates.filter((c) => c.id !== drop.id), slots, order)),
    }));
    costed.sort((a, b) => a.cost.reduce((s, x) => s + x, 0) - b.cost.reduce((s, x) => s + x, 0));
    dropTries.push(...costed.slice(0, opts.dropsTried ?? 3));
  }
  if (dropTries.length === 0) return null;

  const capOf = opts.capOf ?? (() => null);
  const capKeys = days.map((d) => d.capKey);
  const hasCap = [...new Set(capKeys)].some((k) => capOf(k) !== null);
  /** Points of the days with the chain applied (or none), under the games caps. */
  const capped = (cands: LineupCandidate[][]) =>
    plannedTotal(
      cands.map((c) => dayParts(c, slots, order)),
      (i) => ({ key: capKeys[i]!, cap: capOf(capKeys[i]!) }),
    );
  const baseCapped = hasCap ? capped(days.map((d) => d.candidates)) : baseDay.reduce((s, x) => s + x, 0);

  let best: { plan: StreamPlan; claims: number } | null = null;
  for (const { drop } of dropTries) {
    const rosterWithout = days.map((d) => (drop ? d.candidates.filter((c) => c.id !== drop.id) : d.candidates));
    const baseWithout = rosterWithout.map((c) => total(c, slots, order));
    const v = new Map<string, number[]>();
    const cand = new Map<string, Array<LineupCandidate | null>>();
    for (const p of pool) {
      const cs = days.map((d) => d.poolCandidate(p.id));
      cand.set(p.id, cs);
      // The spot is held (the drop is gone) from the stretch's first day: a day without his game costs the drop's lineup points.
      v.set(
        p.id,
        days.map((_, i) => {
          const c = cs[i];
          const withC = c ? total([...rosterWithout[i]!, c], slots, order) : baseWithout[i]!;
          return withC - baseDay[i]!;
        }),
      );
    }
    const chains = solveChains(n, pool.map((p) => p.id), poolStatus, v, wwUsable, maxClaims);
    // Fewer claims first: one more must add `minGain` on top.
    let kept: { chain: Chain; capGain: number } | null = null;
    for (const chain of chains) {
      const applied = days.map((d, i) => {
        const s = chain.stretches.find((x) => i >= x.from && i <= x.to);
        if (!s) return d.candidates;
        const c = cand.get(s.id)![i];
        return c ? [...rosterWithout[i]!, c] : rosterWithout[i]!;
      });
      const capGain = (hasCap ? capped(applied) : applied.reduce((s, c) => s + total(c, slots, order), 0)) - baseCapped;
      if (!kept || capGain >= kept.capGain + opts.minGain) kept = { chain, capGain };
    }
    if (!kept || kept.capGain <= 0) continue;
    const { chain, capGain } = kept;
    const steps: StreamStep[] = chain.stretches.map((s, idx) => {
      const cs = cand.get(s.id)!;
      let games = 0;
      for (let i = s.from; i <= s.to; i++) if (cs[i] && Object.values(cs[i]!.values).some((x) => (x ?? 0) > 0)) games += cs[i]!.games ?? 1;
      return { id: s.id, status: poolStatus.get(s.id)!, from: s.from, to: s.to, games, gain: s.gain, drop: idx === 0 ? drop : null };
    });
    const plan: StreamPlan = { steps, gain: capGain, gainUncapped: chain.gain, capLimited: hasCap && capGain < chain.gain - 0.5 };
    if (!best || plan.gain > best.plan.gain + 1e-9) best = { plan, claims: steps.length };
  }
  return best?.plan ?? null;
}
