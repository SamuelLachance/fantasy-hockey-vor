/**
 * Waiver / free-agent targets: how many points a pickup adds, re-solving the
 * daily lineup with and without him.
 *
 *   Δ(c)   = Σ_period days best(R − d + c) − Σ_period days best(R)
 *   ros(c) = Σ_later days w · [best(R − d + c) − best(R)]
 *
 * `delta` is the rest of the current scoring period; `ros` the rest of the
 * fantasy regular season after it, day by day (`w` = the days a sampled
 * day stands for, 1 when every day is given). Both are lineup deltas: a pickup only
 * counts on nights he would actually start, and the drop only costs the
 * nights he would have started. Targets rank by delta + ros; one whose ros is
 * negative helps this period and costs points afterwards (`rental`), and one
 * that loses points over the season as a whole is not shown.
 *
 * FA pickups play from the next lineup period; WW claims clear after >= 23 h,
 * so they only count from tomorrow. If the roster has room (Active + Reserve
 * below the maximum) no drop is needed; otherwise the three droppable players
 * the lineup misses least (this period and after) are tried.
 *
 * Games caps (Captains' GP / GS per scoring period): when `cap` is given, the
 * period total stops counting skater (goalie) points after the day the
 * expected games played (starts) reach the cap — that day counts in full, as
 * Fantrax scores it. Without that, an add on a team that will hit its cap
 * looks about 2.6 times as good as it is. `ros` stays cap-blind.
 */
import { SLOT_ORDER, type SlotCounts, type SlotId } from "./config";
import { optimizeLineup, type LineupCandidate } from "./lineup";

export interface WaiverDay {
  /** Current roster's lineup candidates for this lineup period. */
  candidates: LineupCandidate[];
  /** A pool player's candidate for this period (null = no game / out). */
  poolCandidate: (id: string) => LineupCandidate | null;
  /** WW claims have cleared by this period. */
  wwUsable: boolean;
  /** Lineup days this one stands for (a sampled later day); 1 by default. */
  weight?: number;
}

export interface WaiverPoolPlayer {
  id: string;
  status: "FA" | "WW";
  /** Best per-game value (shown). */
  fpg: number;
}

export interface DropOption {
  id: string;
  /** "minors" = send a minors-eligible player down (free, keeps him). */
  action: "drop" | "minors";
  fpg: number;
}

export interface WaiverTarget {
  id: string;
  status: "FA" | "WW";
  /** Points added over the rest of the scoring period (cap-aware). */
  delta: number;
  /** Games he would play for you this period (lineup days). */
  days: number;
  fpg: number;
  drop: DropOption | null;
  /**
   * Points added over the rest of the fantasy regular season AFTER this
   * period, lineup-aware (0 without later days to sample).
   */
  ros: number;
  /** ros < 0: worth it this period only, he costs points afterwards. */
  rental?: true;
}

/** Games caps of the current scoring period, and what is already used. */
export interface WaiverCap {
  gpMax: number | null;
  gsMax: number | null;
  /** Expected games played / goalie starts before the first `days` entry. */
  gpUsed: number;
  gsUsed: number;
}

export interface WaiverOptions {
  slotCounts: SlotCounts;
  /** The league's slots, in its own order; the Captains ones by default. */
  slotOrder?: readonly SlotId[];
  /** Counted players are at the Active + Reserve maximum. */
  needsDrop: boolean;
  drops: DropOption[];
  /** Smallest gain this period worth showing (league points). */
  minDelta: number;
  limit?: number;
  /** Sampled lineup days after the period (with `weight`): the ros. */
  rosDays?: WaiverDay[];
  /** The period's games caps; null / absent = no cap. */
  cap?: WaiverCap | null;
}

/**
 * Lineup points over `days`, each day weighted. With a cap, skater (goalie)
 * points stop counting after the day the expected games played (starts)
 * reach it; that day counts in full. A candidate's `games` is the games he
 * plays (starts) that day if he is in the lineup.
 */
export function periodTotal(
  days: WaiverDay[],
  transform: (d: WaiverDay) => LineupCandidate[],
  slots: SlotCounts,
  slotOrder: readonly SlotId[] | undefined,
  cap?: WaiverCap | null,
): number {
  let total = 0;
  let gp = cap?.gpUsed ?? 0;
  let gs = cap?.gsUsed ?? 0;
  const gpMax = cap?.gpMax ?? null;
  const gsMax = cap?.gsMax ?? null;
  for (const d of days) {
    const cands = transform(d);
    const res = optimizeLineup(cands, slots, slotOrder ?? SLOT_ORDER);
    const w = d.weight ?? 1;
    if (!cap) {
      total += w * res.total;
      continue;
    }
    const byId = new Map(cands.map((c) => [c.id, c]));
    let sk = 0;
    let gl = 0;
    let dgp = 0;
    let dgs = 0;
    for (const a of res.assignments) {
      if (!a.playerId || a.value <= 0) continue;
      const games = byId.get(a.playerId)?.games ?? 1;
      if (a.slot === "G") {
        gl += a.value;
        dgs += games;
      } else {
        sk += a.value;
        dgp += games;
      }
    }
    if (gpMax === null || gp < gpMax) total += w * sk;
    if (gsMax === null || gs < gsMax) total += w * gl;
    gp += w * dgp;
    gs += w * dgs;
  }
  return total;
}

export function waiverTargets(
  days: WaiverDay[],
  pool: WaiverPoolPlayer[],
  opts: WaiverOptions,
): WaiverTarget[] {
  const slots = opts.slotCounts;
  const rosDays = opts.rosDays ?? [];
  const total = (ds: WaiverDay[], f: (d: WaiverDay) => LineupCandidate[], cap?: WaiverCap | null) =>
    periodTotal(ds, f, slots, opts.slotOrder, cap);
  const base = total(days, (d) => d.candidates, opts.cap);
  const without = (d: WaiverDay, id: string) => d.candidates.filter((c) => c.id !== id);
  // Later days, solved once per day for the roster and for each drop: a
  // pickup only changes the days he plays, so only those are re-solved.
  const solveDay = (cands: LineupCandidate[]) => optimizeLineup(cands, slots, opts.slotOrder ?? SLOT_ORDER).total;
  const rosBaseByDay = rosDays.map((d) => solveDay(d.candidates));
  const baseRos = rosDays.reduce((s, d, i) => s + (d.weight ?? 1) * rosBaseByDay[i]!, 0);
  const rosWithoutCache = new Map<string, number[]>();
  const rosWithout = (dropId: string | undefined): number[] => {
    if (!dropId) return rosBaseByDay;
    let byDay = rosWithoutCache.get(dropId);
    if (!byDay) {
      byDay = rosDays.map((d) => solveDay(without(d, dropId)));
      rosWithoutCache.set(dropId, byDay);
    }
    return byDay;
  };
  const rosFor = (id: string, dropId: string | undefined): number => {
    const kept = rosWithout(dropId);
    let sum = 0;
    rosDays.forEach((d, i) => {
      const pc = d.poolCandidate(id);
      const day = pc ? solveDay([...(dropId ? without(d, dropId) : d.candidates), pc]) : kept[i]!;
      sum += (d.weight ?? 1) * day;
    });
    return sum - baseRos;
  };

  // Cheapest drops first: what the lineup loses without each player, this
  // period and over the rest of the season.
  const drops = opts.needsDrop
    ? opts.drops
        .map((d) => ({
          d,
          loss:
            base -
            total(days, (day) => without(day, d.id), opts.cap) +
            rosDays.reduce((s, day, i) => s + (day.weight ?? 1) * (rosBaseByDay[i]! - rosWithout(d.id)[i]!), 0),
        }))
        .sort((a, b) => a.loss - b.loss)
        .slice(0, 3)
        .map((x) => x.d)
    : [];
  if (opts.needsDrop && drops.length === 0) return [];

  const out: WaiverTarget[] = [];
  for (const p of pool) {
    const usable = (d: WaiverDay) => p.status === "FA" || d.wwUsable;
    const withPlayer = (d: WaiverDay, dropId: string | undefined) => {
      const kept = dropId ? without(d, dropId) : d.candidates;
      const pc = usable(d) ? d.poolCandidate(p.id) : null;
      return pc ? [...kept, pc] : kept;
    };
    const playDays = days.filter((d) => usable(d) && d.poolCandidate(p.id)).length;
    if (playDays === 0) continue;

    const options = opts.needsDrop ? drops : [null];
    let best: WaiverTarget | null = null;
    for (const drop of options) {
      const delta = total(days, (d) => withPlayer(d, drop?.id), opts.cap) - base;
      // The season-long half is only worth solving for a gain worth showing.
      if (delta < opts.minDelta) continue;
      const ros = rosDays.length ? rosFor(p.id, drop?.id) : 0;
      if (!best || delta + ros > best.delta + best.ros + 1e-9) {
        best = { id: p.id, status: p.status, delta, days: playDays, fpg: p.fpg, drop, ros };
      }
    }
    // A pickup that costs points over the season as a whole is no target.
    if (!best || best.delta + best.ros < 0) continue;
    if (best.ros < 0) best.rental = true;
    out.push(best);
  }
  out.sort((a, b) => b.delta + b.ros - (a.delta + a.ros) || b.delta - a.delta);
  return opts.limit ? out.slice(0, opts.limit) : out;
}
