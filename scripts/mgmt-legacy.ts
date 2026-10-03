/**
 * The games-cap bench policy exactly as shipped at bd259b2, the reference of
 * `backtest-mgmt.ts`: one per-game bar per group for the whole period, and a
 * benched player whose values are zeroed but who stays eligible — so the
 * optimizer still seats him at 0 on a free seat, where he really plays and
 * spends a game (fixed in daily-plan.ts's `withCapBench`).
 */
import type { SlotCounts, SlotId } from "../src/lib/fantrax/config";
import type { LineupCandidate } from "../src/lib/fantrax/lineup";
import { cappedTotal, type DayParts, type WaiverCap } from "../src/lib/fantrax/waivers";
import { optimizeLineup } from "../src/lib/fantrax/lineup";

interface Bars {
  skater: number | null;
  goalie: number | null;
}
const isGoalieCand = (c: LineupCandidate) => c.values.G !== undefined;
function perGameValue(c: LineupCandidate): number {
  const g = c.games ?? 0;
  if (!(g > 0)) return 0;
  const goalie = isGoalieCand(c);
  let best = 0;
  for (const [slot, v] of Object.entries(c.values)) if ((slot === "G") === goalie) best = Math.max(best, v ?? 0);
  return best / g;
}

export function legacyWithCapBench(cands: LineupCandidate[], policy: Bars): LineupCandidate[] {
  return cands.map((c) => {
    if (c.locked) return c;
    const bar = isGoalieCand(c) ? policy.goalie : policy.skater;
    return bar !== null && perGameValue(c) < bar ? { ...c, values: {}, games: 0 } : c;
  });
}

/** bd259b2's `dayParts` (a seated player's games count, 1 by default only for a scoring seat). */
function dayParts(cands: LineupCandidate[], slots: SlotCounts, order: readonly SlotId[]): DayParts {
  const res = optimizeLineup(cands, slots, order);
  const byId = new Map(cands.map((c) => [c.id, c]));
  const out: DayParts = { skaterPoints: 0, goaliePoints: 0, gp: 0, gs: 0 };
  for (const a of res.assignments) {
    if (!a.playerId) continue;
    const games = Math.max(0, byId.get(a.playerId)?.games ?? (a.value > 0 ? 1 : 0));
    const points = Math.max(0, a.value);
    if (a.slot === "G") {
      out.goaliePoints += points;
      out.gs += games;
    } else {
      out.skaterPoints += points;
      out.gp += games;
    }
  }
  return out;
}

export function legacyCapBenchPolicy(
  days: LineupCandidate[][],
  slots: SlotCounts,
  order: readonly SlotId[],
  cap: WaiverCap,
  binds: { gp: boolean; gs: boolean },
): (Bars & { gain: number }) | null {
  const counted = (policy: Bars) =>
    cappedTotal(
      days.map((d) => dayParts(legacyWithCapBench(d, policy), slots, order)),
      days.map(() => 1),
      () => ({ key: 0, cap }),
    );
  const base = counted({ skater: null, goalie: null });
  const bars = (goalie: boolean) =>
    [...new Set(days.flat().filter((c) => isGoalieCand(c) === goalie).map(perGameValue).filter((v) => v > 0))].sort((a, b) => a - b);
  let best: Bars = { skater: null, goalie: null };
  let bestTotal = base;
  for (const group of ["skater", "goalie"] as const) {
    if (!(group === "skater" ? binds.gp : binds.gs)) continue;
    for (const v of bars(group === "goalie")) {
      const policy = { ...best, [group]: Math.ceil((v + 1e-9) * 1e4) / 1e4 };
      const total = counted(policy);
      if (total > bestTotal + 1e-9) {
        bestTotal = total;
        best = policy;
      }
    }
  }
  const gain = bestTotal - base;
  if (gain < 0.5) return null;
  const up = (x: number | null) => (x === null ? null : Math.ceil(x * 1e4) / 1e4);
  return { skater: up(best.skater), goalie: up(best.goalie), gain };
}
