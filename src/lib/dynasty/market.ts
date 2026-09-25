/**
 * Market layer (§3.11), for the segments where the model is thin only:
 * prospects (Fantrax Ros%, a dynasty-flavoured crowd signal, ADP as the
 * tie-break) and NHL-path goalies (ADP, which carries starter news). NHL
 * skaters get no market weight: redraft ADP biases against youth; it is
 * shown, never blended.
 *
 * Level-neutral quantile anchoring (audit 2026-09-25): each segment is
 * anchored on its own ladder — its members that carry a weight and a signal,
 * ranked by the signal and mapped onto the same members' model values — so
 * the crowd reorders a segment without moving its level. (Anchoring on the
 * whole minors-eligible pool let NHL-path youngsters, whom Ros% favours for
 * being in the NHL already, take the top anchors and pushed every real
 * prospect down.) Fringe players (no model) are placed on the prospect
 * ladder of their kind (skater or goalie).
 *
 * Blend in u = ln(DV + 10): u_post = u_M + w·(u_K − u_M), the move capped at
 * ×/÷2.5 when w < 0.5. One posterior factor (the balanced one) scales every
 * mode, so the exported per-season gains stay exact for every mode.
 *
 * The market rank and the gap (market rank − model rank) stay pool-wide
 * (P: prospect path or minors-eligible now, by Ros%; G: other goalies, by
 * ADP; S: everyone else, by ADP): they are information for the board and the
 * sentence ("le marché le paie plus cher"), never an anchor.
 */
import type { DynastyParams } from "./params";
import { MODES, type Group, type MarketSeg, type Mode } from "./types";

export type MarketPool = "P" | "G" | "S";

export interface MarketMember {
  id: string;
  pool: MarketPool;
  seg: MarketSeg;
  /** Position group (places fringe players on the skater or goalie ladder); default F. */
  g?: Group;
  ros?: number;
  adp?: number;
  dvModel: Record<Mode, number>;
}

export interface MarketOutcome {
  dv: Record<Mode, number>;
  /** Market rank within the pool (average rank on ties), 1-based. */
  rank?: number;
  /** Model DV at the anchor (balanced); pool-wide quantile when not anchored (information). */
  dvMkt?: number;
  w: number;
  /** Market rank − model rank within the pool (negative: the market pays more). */
  gap?: number;
  /** True when the posterior differs from the model in some mode. */
  moved: boolean;
}

const MISSING_KEY = 300;

type Signal = "ros" | "adp";

/** Pool-wide signal (information: market rank and gap). */
export function hasSignal(p: DynastyParams, m: Pick<MarketMember, "pool" | "ros" | "adp">): boolean {
  return has(p, m, m.pool === "P" ? "ros" : "adp");
}

function has(p: DynastyParams, m: Pick<MarketMember, "ros" | "adp">, s: Signal): boolean {
  return s === "ros" ? m.ros != null && m.ros > 0 : m.adp != null && m.adp < p.market.adpMissing;
}

/** Smaller is better: Ros% descending with ADP as the tie-break, or ADP ascending. */
function key(p: DynastyParams, m: Pick<MarketMember, "ros" | "adp">, s: Signal): number {
  const adp = m.adp != null && m.adp < p.market.adpMissing ? m.adp : MISSING_KEY;
  return s === "ros" ? -(m.ros ?? 0) * 1000 + adp : adp;
}

const PROSPECT_SKATER: readonly MarketSeg[] = ["prospect", "prospect_nhl", "prospect_slot"];
const NHL_GOALIE: readonly MarketSeg[] = ["G_est", "G_young"];

/**
 * The ladder a member is anchored on and its signal: its own segment, or the
 * prospect ladder of his kind for fringe players; null = never anchored.
 */
function ladderOf(m: Pick<MarketMember, "pool" | "seg" | "g">): { segs: readonly MarketSeg[]; signal: Signal } | null {
  if (m.pool === "S") return null;
  if (NHL_GOALIE.includes(m.seg)) return { segs: [m.seg], signal: "adp" };
  if (m.seg === "G_prospect" || PROSPECT_SKATER.includes(m.seg)) return { segs: [m.seg], signal: "ros" };
  if (m.seg === "fringe") {
    if (m.pool === "G") return { segs: NHL_GOALIE, signal: "adp" };
    return m.g === "G" ? { segs: ["G_prospect"], signal: "ros" } : { segs: PROSPECT_SKATER, signal: "ros" };
  }
  return null;
}

/** Weight of the market for a segment (0 for pool S and when disabled). */
export function marketWeight(p: DynastyParams, m: Pick<MarketMember, "pool" | "seg">, enabled = p.market.enabled): number {
  if (!enabled || m.pool === "S") return 0;
  return p.market.weights[m.seg] ?? 0;
}

/** Posterior of one value: u = ln(DV + off), capped move when w < 0.5. */
export function blend(p: DynastyParams, model: number, anchor: number, w: number): number {
  if (!(w > 0)) return model;
  const off = p.market.offset;
  const uM = Math.log(Math.max(0, model) + off);
  const uK = Math.log(Math.max(0, anchor) + off);
  let du = w * (uK - uM);
  if (w < 0.5) {
    const cap = Math.log(p.market.capRatio);
    du = Math.max(-cap, Math.min(cap, du));
  }
  return Math.exp(uM + du) - off;
}

/** Below this model value (balanced) the posterior cannot be a multiple of the model. */
export const MODEL_FLOOR = 0.5;

interface Ladder {
  keys: number[];
  dv: Record<Mode, number[]>;
}

function makeLadder(p: DynastyParams, mem: readonly MarketMember[], s: Signal): Ladder {
  const keys = mem.map((m) => key(p, m, s)).sort((a, b) => a - b);
  const dv = {} as Record<Mode, number[]>;
  for (const mode of MODES) dv[mode] = mem.map((m) => m.dvModel[mode]).sort((a, b) => b - a);
  return { keys, dv };
}

/** Index on the ladder for a market key: average position of the ties, else the insertion point. */
function positionOn(l: Ladder, k: number): number {
  let lo = 0;
  while (lo < l.keys.length && l.keys[lo]! < k) lo++;
  let hi = lo;
  while (hi < l.keys.length && l.keys[hi] === k) hi++;
  const at = hi > lo ? Math.round((lo + hi - 1) / 2) : lo;
  return Math.min(at, l.keys.length - 1);
}

export function applyMarket(
  p: DynastyParams,
  members: readonly MarketMember[],
  enabled = p.market.enabled,
): Map<string, MarketOutcome> {
  const out = new Map<string, MarketOutcome>();
  for (const m of members) out.set(m.id, { dv: { ...m.dvModel }, w: 0, moved: false });

  // ---- pool-wide market rank and gap (information)
  const poolDvMkt = new Map<string, number>();
  for (const pool of ["P", "G", "S"] as const) {
    const s: Signal = pool === "P" ? "ros" : "adp";
    const mem = members.filter((m) => m.pool === pool && has(p, m, s));
    if (!mem.length) continue;
    const byMkt = [...mem].sort((a, b) => key(p, a, s) - key(p, b, s) || a.id.localeCompare(b.id));
    const keys = byMkt.map((m) => key(p, m, s));
    const byModel = [...mem].sort((a, b) => b.dvModel.balanced - a.dvModel.balanced || a.id.localeCompare(b.id));
    const modelRank = new Map(byModel.map((m, i) => [m.id, i + 1]));
    const sorted = mem.map((m) => m.dvModel.balanced).sort((a, b) => b - a);
    byMkt.forEach((m, i) => {
      let j = i;
      while (j + 1 < byMkt.length && keys[j + 1] === keys[i]) j++;
      let k = i;
      while (k - 1 >= 0 && keys[k - 1] === keys[i]) k--;
      const o = out.get(m.id)!;
      o.rank = (k + j) / 2 + 1;
      o.gap = o.rank - modelRank.get(m.id)!;
      poolDvMkt.set(m.id, sorted[Math.round((k + j) / 2)]!);
    });
  }

  // ---- anchoring, one ladder per segment (members with a weight and the signal)
  const anchored = (m: MarketMember) => {
    const l = ladderOf(m);
    return l != null && marketWeight(p, m, enabled) > 0 && has(p, m, l.signal) ? l : null;
  };
  const ladders = new Map<string, Ladder>();
  const ladderFor = (segs: readonly MarketSeg[], s: Signal): Ladder | null => {
    const id = `${segs.join("+")}|${s}`;
    if (!ladders.has(id)) {
      const mem = members.filter((m) => segs.includes(m.seg) && m.seg !== "fringe" && anchored(m) != null);
      ladders.set(id, mem.length ? makeLadder(p, mem, s) : { keys: [], dv: { winNow: [], balanced: [], longTerm: [] } });
    }
    const l = ladders.get(id)!;
    return l.keys.length ? l : null;
  };

  for (const m of members) {
    const o = out.get(m.id)!;
    const spec = anchored(m);
    const ladder = spec ? ladderFor(spec.segs, spec.signal) : null;
    if (!spec || !ladder) {
      if (poolDvMkt.has(m.id)) o.dvMkt = poolDvMkt.get(m.id)!;
      continue;
    }
    const w = marketWeight(p, m, enabled);
    const at = positionOn(ladder, key(p, m, spec.signal));
    o.w = w;
    o.dvMkt = ladder.dv.balanced[at]!;
    const modelBal = m.dvModel.balanced;
    const postBal = blend(p, modelBal, ladder.dv.balanced[at]!, w);
    if (modelBal >= MODEL_FLOOR) {
      // one factor for every mode: eG × k stays exact for all of them
      const k = Math.max(0, postBal) / modelBal;
      for (const mode of MODES) o.dv[mode] = m.dvModel[mode] * k;
    } else {
      for (const mode of MODES) o.dv[mode] = blend(p, m.dvModel[mode], ladder.dv[mode][at]!, w);
    }
    o.moved = MODES.some((mode) => Math.abs(o.dv[mode] - m.dvModel[mode]) > 1e-9);
  }
  return out;
}
