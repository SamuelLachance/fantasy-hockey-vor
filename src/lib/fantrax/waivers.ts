/**
 * Waiver / free-agent targets: how many points a pickup adds over the rest
 * of the current scoring period, re-solving the daily lineup with and
 * without him.
 *
 *   Δ(c) = Σ_days best(R − d + c) − Σ_days best(R)
 *
 * FA pickups play from the next lineup period; WW claims clear after >= 23 h,
 * so they only count from tomorrow. If the roster has room (Active + Reserve
 * below 20) no drop is needed; otherwise the three cheapest droppable
 * players are tried. The games-cap planner (Phase 3) is not applied here —
 * in period 1 the caps cannot bind without streaming.
 */
import type { SlotId } from "./config";
import { optimizeLineup, type LineupCandidate } from "./lineup";

export interface WaiverDay {
  /** Current roster's lineup candidates for this lineup period. */
  candidates: LineupCandidate[];
  /** A pool player's candidate for this period (null = no game / out). */
  poolCandidate: (id: string) => LineupCandidate | null;
  /** WW claims have cleared by this period. */
  wwUsable: boolean;
}

export interface WaiverPoolPlayer {
  id: string;
  status: "FA" | "WW";
  /** Best per-game value (season-long ROS tie-break). */
  fpg: number;
  /** Team games left this season (ROS tie-break). */
  gamesLeftSeason: number;
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
  delta: number;
  /** Games he would play for you this period (lineup days). */
  days: number;
  fpg: number;
  drop: DropOption | null;
  /** (fpg_c − fpg_d) × his team's games left: long-run tie-break. */
  ros: number;
}

export interface WaiverOptions {
  slotCounts: Record<SlotId, number>;
  /** Counted players are at the Active + Reserve maximum. */
  needsDrop: boolean;
  drops: DropOption[];
  minDelta: number;
  limit?: number;
}

function periodTotal(days: WaiverDay[], transform: (d: WaiverDay) => LineupCandidate[], slots: Record<SlotId, number>): number {
  let total = 0;
  for (const d of days) total += optimizeLineup(transform(d), slots).total;
  return total;
}

export function waiverTargets(
  days: WaiverDay[],
  pool: WaiverPoolPlayer[],
  opts: WaiverOptions,
): WaiverTarget[] {
  const slots = opts.slotCounts;
  const base = periodTotal(days, (d) => d.candidates, slots);

  // Cheapest drops first: what the current plan loses without each player.
  const drops = opts.needsDrop
    ? opts.drops
        .map((d) => ({
          d,
          loss: base - periodTotal(days, (day) => day.candidates.filter((c) => c.id !== d.id), slots),
        }))
        .sort((a, b) => a.loss - b.loss)
        .slice(0, 3)
        .map((x) => x.d)
    : [];
  if (opts.needsDrop && drops.length === 0) return [];

  const out: WaiverTarget[] = [];
  for (const p of pool) {
    const usable = (d: WaiverDay) => p.status === "FA" || d.wwUsable;
    const withPlayer = (d: WaiverDay, dropId?: string) => {
      const kept = dropId ? d.candidates.filter((c) => c.id !== dropId) : d.candidates;
      const pc = usable(d) ? d.poolCandidate(p.id) : null;
      return pc ? [...kept, pc] : kept;
    };
    const playDays = days.filter((d) => usable(d) && d.poolCandidate(p.id)).length;
    if (playDays === 0) continue;

    const options = opts.needsDrop ? drops : [null];
    let best: WaiverTarget | null = null;
    for (const drop of options) {
      const delta = periodTotal(days, (d) => withPlayer(d, drop?.id), slots) - base;
      const ros = (p.fpg - (drop?.fpg ?? 0)) * p.gamesLeftSeason;
      if (!best || delta > best.delta + 1e-9) {
        best = { id: p.id, status: p.status, delta, days: playDays, fpg: p.fpg, drop, ros };
      }
    }
    if (best && best.delta >= opts.minDelta) out.push(best);
  }
  out.sort((a, b) => (Math.abs(b.delta - a.delta) > 0.05 ? b.delta - a.delta : b.ros - a.ros));
  return opts.limit ? out.slice(0, opts.limit) : out;
}
