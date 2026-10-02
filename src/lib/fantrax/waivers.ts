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
 * looks about 2.6 times as good as it is. `ros` applies each later period's
 * own caps the same way (`rosCaps`, the counter at 0 when the period opens):
 * blind to them, an add whose games only push a full roster into its cap
 * earlier read as a gain over the season.
 *
 * Only the games of players in ACTIVE lineup slots count toward a cap (the
 * Fantrax rule): the lineup's assignments. A Reserve, IR or Minors player
 * accrues nothing, whatever his team plays.
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
  /** Scoring period of the day (later days: the key of `rosCaps`). */
  capPeriod?: number;
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
   * period, lineup-aware and under each later period's games caps when
   * `rosCaps` is given (0 without later days to sample).
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
  /**
   * Games caps of the later scoring periods, by `capPeriod` of the `rosDays`
   * (nothing used when each opens); absent = the rest of season is cap-blind.
   */
  rosCaps?: ReadonlyMap<number, Pick<WaiverCap, "gpMax" | "gsMax">> | null;
}

/** One lineup day split for the games caps: points and games of the lineup (ACTIVE slots only). */
export interface DayParts {
  skaterPoints: number;
  goaliePoints: number;
  /** Expected games played by the skaters in the lineup. */
  gp: number;
  /** Expected starts of the goalies in the lineup. */
  gs: number;
}

/** The optimal lineup of a day, split into capped parts. */
export function dayParts(
  cands: LineupCandidate[],
  slots: SlotCounts,
  slotOrder: readonly SlotId[] | undefined,
): DayParts {
  const res = optimizeLineup(cands, slots, slotOrder ?? SLOT_ORDER);
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out: DayParts = { skaterPoints: 0, goaliePoints: 0, gp: 0, gs: 0 };
  for (const a of res.assignments) {
    if (!a.playerId || a.value <= 0) continue;
    const games = byId.get(a.playerId)?.games ?? 1;
    if (a.slot === "G") {
      out.goaliePoints += a.value;
      out.gs += games;
    } else {
      out.skaterPoints += a.value;
      out.gp += games;
    }
  }
  return out;
}

/**
 * Counted points of consecutive days under games caps: a period's skater
 * (goalie) points stop counting after the day its expected games (starts)
 * reach the cap; that day counts in full. `capOf(i)` gives day i's cap and
 * a key: the counters restart (from the cap's `gpUsed` / `gsUsed`) when the
 * key changes. Days carry their weight.
 */
export function cappedTotal(
  parts: readonly DayParts[],
  weights: readonly number[],
  capOf: (i: number) => { key: number; cap: WaiverCap | null },
): number {
  let total = 0;
  let key: number | null = null;
  let gp = 0;
  let gs = 0;
  for (let i = 0; i < parts.length; i++) {
    const d = parts[i]!;
    const w = weights[i] ?? 1;
    const { key: k, cap } = capOf(i);
    if (k !== key) {
      key = k;
      gp = cap?.gpUsed ?? 0;
      gs = cap?.gsUsed ?? 0;
    }
    const gpMax = cap?.gpMax ?? null;
    const gsMax = cap?.gsMax ?? null;
    if (gpMax === null || gp < gpMax) total += w * d.skaterPoints;
    if (gsMax === null || gs < gsMax) total += w * d.goaliePoints;
    gp += w * d.gp;
    gs += w * d.gs;
  }
  return total;
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
  if (!cap) {
    let total = 0;
    for (const d of days) total += (d.weight ?? 1) * optimizeLineup(transform(d), slots, slotOrder ?? SLOT_ORDER).total;
    return total;
  }
  return cappedTotal(
    days.map((d) => dayParts(transform(d), slots, slotOrder)),
    days.map((d) => d.weight ?? 1),
    () => ({ key: 0, cap }),
  );
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
  // pickup only changes the days he plays, so only those are re-solved. Each
  // later period's games caps then apply to the day-by-day parts.
  const rosCaps = opts.rosCaps ?? null;
  const rosWeights = rosDays.map((d) => d.weight ?? 1);
  const rosCapOf = (i: number) => {
    const key = rosDays[i]!.capPeriod ?? -1;
    const c = rosCaps?.get(key);
    return { key, cap: c ? { gpMax: c.gpMax, gsMax: c.gsMax, gpUsed: 0, gsUsed: 0 } : null };
  };
  const rosTotal = (parts: DayParts[]) => cappedTotal(parts, rosWeights, rosCapOf);
  const solveDay = (cands: LineupCandidate[]) => dayParts(cands, slots, opts.slotOrder);
  const rosBaseByDay = rosDays.map((d) => solveDay(d.candidates));
  const baseRos = rosTotal(rosBaseByDay);
  const rosWithoutCache = new Map<string, DayParts[]>();
  const rosWithout = (dropId: string | undefined): DayParts[] => {
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
    const parts = rosDays.map((d, i) => {
      const pc = d.poolCandidate(id);
      return pc ? solveDay([...(dropId ? without(d, dropId) : d.candidates), pc]) : kept[i]!;
    });
    return rosTotal(parts) - baseRos;
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
            (baseRos - rosTotal(rosWithout(d.id))),
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
