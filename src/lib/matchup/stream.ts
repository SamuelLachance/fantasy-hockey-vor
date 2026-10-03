/**
 * Decisions for the week, scored by the simulator itself (`simulate.ts`):
 *
 * - streaming: every free agent added in place of each of the user's
 *   cheapest players of the same kind, the week re-simulated with the same
 *   random numbers (common random numbers: only the swap moves the answer),
 *   ranked by expected categories won;
 * - goalies: start every goalie who starts, or stop at 4, 5 or 6
 *   appearances to protect GAA and SV% — whichever wins more categories.
 *
 * Pure; the callers chunk the work (the browser yields between candidates).
 */
import { simulateWeek, type SimDay, type SimGoalie, type SimLeague, type SimResult, type SimSkater, type SimTeam } from "./simulate";
import type { MatchupParams } from "./params";

export interface SimOpts {
  sims?: number;
  seed?: string;
  league?: SimLeague;
  params?: MatchupParams;
}

export type Candidate = { kind: "skater"; p: SimSkater } | { kind: "goalie"; p: SimGoalie };

export interface SwapResult {
  add: Candidate;
  /** The player let go (id), the cheapest of his kind that gave the best week. */
  drop: number;
  dropName: string;
  /** Expected categories won and P(win the week) after the swap, and their change. */
  expCats: number;
  win: number;
  dExpCats: number;
  dWin: number;
  /** Seated games the added player is expected to get. */
  games: number;
}

/** The players the user could let go for `kind`: the `n` lowest priorities (a goalie only for a goalie). */
export function dropOptions(me: SimTeam, kind: "skater" | "goalie", n = 2): Array<{ id: number; name: string }> {
  const pool = kind === "goalie" ? me.goalies : me.skaters;
  return [...pool]
    .sort((a, b) => a.prio - b.prio || a.id - b.id)
    .slice(0, n)
    .map((p) => ({ id: p.id, name: p.name }));
}

export function withSwap(me: SimTeam, add: Candidate, drop: number): SimTeam {
  if (add.kind === "skater") return { ...me, skaters: [...me.skaters.filter((p) => p.id !== drop), add.p], goalies: me.goalies.filter((g) => g.id !== drop) };
  return { ...me, goalies: [...me.goalies.filter((g) => g.id !== drop), add.p], skaters: me.skaters.filter((p) => p.id !== drop) };
}

/** One candidate scored against the baseline week (`base`, from the same options). */
export function scoreCandidate(
  me: SimTeam,
  opp: SimTeam,
  days: readonly SimDay[],
  add: Candidate,
  base: SimResult,
  opts: SimOpts & { drops?: number; fixedDrop?: number },
): SwapResult | null {
  const drops = opts.fixedDrop != null ? [{ id: opts.fixedDrop, name: nameOf(me, opts.fixedDrop) }] : dropOptions(me, add.kind, opts.drops ?? 2);
  let best: SwapResult | null = null;
  for (const d of drops) {
    const team = withSwap(me, add, d.id);
    const r = simulateWeek(team, opp, days, opts);
    const res: SwapResult = {
      add,
      drop: d.id,
      dropName: d.name,
      expCats: r.expCats,
      win: r.win,
      dExpCats: r.expCats - base.expCats,
      dWin: r.win - base.win,
      games: add.kind === "skater" ? (r.games.get(add.p.id) ?? 0) : 0,
    };
    if (!best || res.dExpCats > best.dExpCats) best = res;
  }
  return best;
}

function nameOf(me: SimTeam, id: number): string {
  return [...me.skaters, ...me.goalies].find((p) => p.id === id)?.name ?? String(id);
}

export interface GoaliePlan {
  cap: number;
  expCats: number;
  win: number;
  /** Expected appearances under this plan. */
  apps: number;
  pMin: number;
}

/** Goalie caps the planner compares (Infinity = start every goalie who starts). */
export const GOALIE_CAPS = [Infinity, 4, 5, 6] as const;

/** Every goalie plan of `GOALIE_CAPS`, best (expected categories) first. */
export function goaliePlans(me: SimTeam, opp: SimTeam, days: readonly SimDay[], opts: SimOpts): GoaliePlan[] {
  return GOALIE_CAPS.map((cap) => {
    const r = simulateWeek({ ...me, goalieCap: cap }, opp, days, opts);
    return { cap, expCats: r.expCats, win: r.win, apps: r.apps.mine, pMin: r.apps.pMinMine };
  }).sort((a, b) => b.expCats - a.expCats || (a.cap === Infinity ? -1 : b.cap === Infinity ? 1 : b.cap - a.cap));
}

/**
 * The plan to recommend: stopping early only when it beats « always start »
 * by more than the simulation noise (`margin` categories).
 */
export function recommendGoaliePlan(plans: readonly GoaliePlan[], margin = 0.05): GoaliePlan {
  const always = plans.find((p) => p.cap === Infinity)!;
  const best = plans[0]!;
  return best.expCats - always.expCats > margin ? best : always;
}
