/**
 * From simulated paths to dynasty values (§3.9–3.10): the keeper-slot cost
 * K, per-season expectations, the mode values and their bands.
 *
 * DV(δ, w0, w1) = Σ_{t=0}^{11} w_t · δ^t · E[G_t], w_0 = w0, w_1 = w1 (1
 * unless set: the long-term mode also discounts 2027-28), w_t = 1 after.
 * Because E[G_t] is exported, any δ is exact from one simulation (the keep
 * decision uses a fixed δ_keep = 0.75, independent of the user's mode).
 */
import type { DynastyParams } from "./params";
import { mean, sortedQuantile } from "./rng";
import { simulatePlayer, type SimContext, type SimPlayer, type SimResult } from "./simulate";
import { MODES, type Mode } from "./types";

export interface ModeWeight {
  delta: number;
  w0: number;
  /** Weight of season 1 (2027-28); 1 when absent. */
  w1?: number;
}
export type ModeWeights = Record<Mode, ModeWeight>;

const mw = (m: { delta: number; w0: number; w1?: number }): ModeWeight => ({ delta: m.delta, w0: m.w0, ...(m.w1 != null ? { w1: m.w1 } : {}) });

export function modeWeights(p: DynastyParams): ModeWeights {
  return { winNow: mw(p.modes.winNow), balanced: mw(p.modes.balanced), longTerm: mw(p.modes.longTerm) };
}

/** w_t δ^t of season t. */
export function modeWeight(m: ModeWeight, t: number): number {
  return (t === 0 ? m.w0 : t === 1 ? (m.w1 ?? 1) : 1) * Math.pow(m.delta, t);
}

/** Σ w_t δ^t x_t. */
export function discount(xs: ArrayLike<number>, m: ModeWeight): number {
  let s = 0;
  for (let t = 0; t < xs.length; t++) s += modeWeight(m, t) * xs[t]!;
  return s;
}

export interface KCalibration {
  /** Slot cost charged per kept non-eligible season: the 160th largest E[V_1]. */
  value: number;
  /** [192nd, 128th] largest E[V_1] (low, high). */
  band: [number, number];
  /**
   * Keep-index threshold at a cutdown: the 160th largest keep index at the
   * 2027 cutdown in each simulated league (path n of every player), averaged.
   */
  gate: number;
  /** P10 / P90 of that 160th keep index across simulated leagues. */
  gateBand: [number, number];
  /** Players in the non-eligible pool. */
  pool: number;
  fallback: boolean;
}

/**
 * From an ungated pass (500 paths, own seed), held constant for every
 * cutdown (stationarity):
 *   K (charged)  = the 160th largest E[V_1] among players with P(eligible
 *                  at the 2027 cutdown) < 0.5 — the marginal keeper's season;
 *   gate         = the 160th largest keep index (KI) at the 2027 cutdown per
 *                  simulated league, averaged — the same marginal keeper in
 *                  KI units (a 4-season δ-weighted look-ahead with a games
 *                  haircut runs ≈ 0.83 × V_1 at the line). Comparing KI with
 *                  K itself kept only ~143 of 160 (keeper audit 2026-09-25).
 */
export function calibrateK(
  p: DynastyParams,
  players: readonly SimPlayer[],
  base: Omit<SimContext, "K" | "N" | "keepGate" | "seedKey">,
): KCalibration {
  const N = p.K.pass1Paths;
  const ctx: SimContext = { ...base, K: 0, N, keepGate: false, seedKey: "|k", recordKi: true };
  const rows: Array<{ e1: number; elig1: number }> = [];
  const kis: Float64Array[] = [];
  for (const pl of players) {
    const r = simulatePlayer(pl, ctx);
    rows.push({ e1: mean(r.vorPre[1]!), elig1: r.eligAt[1]! });
    if (r.ki1 && r.eligAt[1]! < 1) kis.push(r.ki1);
  }
  const pool = rows.filter((x) => x.elig1 < 0.5).map((x) => x.e1).sort((a, b) => b - a);
  const [lo, hi] = p.K.band;
  if (pool.length < p.K.rank) {
    return { value: p.K.fallback, band: [p.K.fallback, p.K.fallback], gate: p.K.fallback, gateBand: [p.K.fallback, p.K.fallback], pool: pool.length, fallback: true };
  }
  // per simulated league: the rank-th largest keep index among non-eligible paths
  const perLeague = new Float64Array(N);
  const col = new Float64Array(kis.length);
  for (let n = 0; n < N; n++) {
    let m = 0;
    for (const k of kis) {
      const x = k[n]!;
      if (!Number.isNaN(x)) col[m++] = x;
    }
    const vals = col.subarray(0, m).sort().reverse();
    perLeague[n] = m >= p.K.rank ? vals[p.K.rank - 1]! : 0;
  }
  const sorted = Float64Array.from(perLeague).sort();
  return {
    value: pool[p.K.rank - 1]!,
    band: [pool[Math.min(pool.length, hi) - 1]!, pool[lo - 1]!],
    gate: mean(perLeague),
    gateBand: [sortedQuantile(sorted, 0.1), sortedQuantile(sorted, 0.9)],
    pool: pool.length,
    fallback: false,
  };
}

export interface PlayerValue {
  eG: number[];
  eFP: number[];
  p50G: number[];
  dv: Record<Mode, number>;
  band: { balanced: [number, number, number]; longTerm: [number, number, number] };
  pElig: number[];
  /** kept / gated at each cutdown (null when almost never gated). */
  pKept: Array<number | null>;
  /** Share of paths kept at each cutdown (a non-eligible slot used). */
  keptShare: number[];
  pInNhl: number[];
  pMade: number;
  etaMedian: number | null;
  /** Share of the balanced value from 2026-27 and 2027-28. */
  nearShare: number;
  binding: "age" | "gp" | null;
  /** Expected yearly change of the per-game level over two seasons (NHL path), else null. */
  trend: number | null;
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[(s.length - 1) >> 1]!;
}

export function summarize(res: SimResult, modes: ModeWeights): PlayerValue {
  const { N, T } = res;
  const eG = res.gain.map((a) => mean(a));
  const eFP = res.fp.map((a) => mean(a));
  const p50G = res.gain.map((a) => sortedQuantile(Float64Array.from(a).sort(), 0.5));
  const dv = {} as Record<Mode, number>;
  for (const m of MODES) dv[m] = discount(eG, modes[m]);
  const bandOf = (m: Mode): [number, number, number] => {
    const s = new Float64Array(N);
    const w = modes[m];
    for (let n = 0; n < N; n++) {
      let x = 0;
      for (let t = 0; t < T; t++) x += modeWeight(w, t) * res.gain[t]![n]!;
      s[n] = x;
    }
    s.sort();
    return [sortedQuantile(s, 0.1), sortedQuantile(s, 0.5), sortedQuantile(s, 0.9)];
  };
  let tot = 0;
  let near = 0;
  for (let t = 0; t < T; t++) {
    const w = Math.pow(modes.balanced.delta, t) * eG[t]!;
    tot += w;
    if (t <= 1) near += w;
  }
  const lost = res.lostBy.age + res.lostBy.gp;
  return {
    eG,
    eFP,
    p50G,
    dv,
    band: { balanced: bandOf("balanced"), longTerm: bandOf("longTerm") },
    pElig: res.eligAt,
    pKept: res.gateAt.map((gt, t) => (gt > 0.02 ? res.keptAt[t]! / gt : null)),
    keptShare: res.keptAt,
    pInNhl: res.inNhl,
    pMade: res.pMade,
    etaMedian: median(res.arrivals),
    nearShare: tot > 0 ? near / tot : 0,
    binding: lost > 0 ? (res.lostBy.gp > res.lostBy.age ? "gp" : "age") : null,
    trend: res.lvlRel ? Math.sqrt(res.lvlRel[2]! / res.lvlRel[0]!) - 1 : null,
  };
}
