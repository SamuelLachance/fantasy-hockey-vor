/**
 * Salary-cap roster fit (Slapshot: 105 M$ over the 23 Active + Reserve
 * players, 70 M$ floor, Minors open to any player and cap-free): which
 * players to stash in the Minors and which to call up so the counted roster
 * stays between the floor and the cap and scores the most.
 *
 * The objective is the lineup itself: expected points of the best daily
 * lineup over the rest of the season (`optimizeLineup` on each day's
 * candidates restricted to the counted players), so a fourth goalie or a
 * sixth right winger is worth what he adds to the lineup, not his own season
 * total. Best-improvement local search over single moves (a player down, a
 * player up) and swaps, from the roster as it is and from the rule by hand,
 * with the cap, the floor, the 23 spots and the Minors limit as constraints
 * (a large penalty outside them until the roster is legal). The search runs
 * on `searchDays` evenly spaced days (a lineup solve per day per roster
 * tried); every roster it stepped through is then re-scored on all the days,
 * and the best of those is the advice — the sample alone overfit (it advised
 * moves that lost points on the full season: Montreal -54).
 *
 * scripts/backtest-cap-fit.ts measures it on the 32 real Slapshot rosters
 * against the rule by hand (`capFitByHand`) and the roster as it is.
 */
import type { FantraxPriors, SlotCounts, SlotId } from "./config";
import type { DailyPlan } from "./daily-plan";
import { bestFpg, isGoalieRecord } from "./draft-inputs";
import { optimizeLineup, type LineupCandidate } from "./lineup";
import { dayToDayFactor, skaterPlayProbability } from "./points-model";
import type { ContractsFile } from "./salary-cap";
import type { ValuesSnapshot } from "./snapshot-types";

export interface CapFitPlayer {
  id: string;
  /** ACTIVE / RESERVE / MINORS (IR and others are left where they are). */
  status: string;
  /** Cap hit this season, M$. */
  hit: number;
}

export interface CapFitRules {
  cap: number;
  floor: number;
  /** Counted spots (Active + Reserve): 23. */
  spots: number;
  maxMinors: number;
}

export interface CapFitMove {
  id: string;
  to: "MINORS" | "RESERVE";
}

export interface CapFitResult {
  moves: CapFitMove[];
  /** Counted cap hits before / after the moves, M$. */
  usedBefore: number;
  usedAfter: number;
  /** Expected lineup points over all the days (weighted), before / after. */
  before: number;
  after: number;
  /** The counted roster is within the cap, the floor, the spots and the Minors limit after the moves. */
  legal: boolean;
}

const PENALTY = 1000;

/** Days the local search solves lineups on (the finalists are re-scored on all of them). */
export const CAP_FIT_SEARCH_DAYS = 6;

/**
 * Expected lineup points of a counted set over the days (weights = the days
 * each stands for).
 */
export function countedValue(
  counted: ReadonlySet<string>,
  days: readonly LineupCandidate[][],
  weights: readonly number[],
  slots: SlotCounts,
  order: readonly SlotId[],
): number {
  let total = 0;
  days.forEach((cands, i) => {
    const res = optimizeLineup(
      cands.filter((c) => counted.has(c.id)).map((c) => ({ ...c, status: "ACTIVE", currentSlot: undefined })),
      slots,
      order,
    );
    total += (weights[i] ?? 1) * res.total;
  });
  return total;
}

export function capFit(
  players: readonly CapFitPlayer[],
  rules: CapFitRules,
  days: readonly LineupCandidate[][],
  weights: readonly number[],
  slots: SlotCounts,
  order: readonly SlotId[],
  opts: { searchDays?: number; maxIter?: number; maxCallUps?: number } = {},
): CapFitResult {
  const searchDays = opts.searchDays ?? CAP_FIT_SEARCH_DAYS;
  const maxIter = opts.maxIter ?? 40;
  // Minors players tried for a call-up: the best this many by their own value over the days.
  const maxCallUps = opts.maxCallUps ?? 10;
  const own = new Map<string, number>();
  days.forEach((cands, i) => {
    for (const c of cands) own.set(c.id, (own.get(c.id) ?? 0) + (weights[i] ?? 1) * Math.max(0, ...Object.values(c.values).map((v) => v ?? 0)));
  });
  const callUps = new Set(
    players
      .filter((p) => p.status === "MINORS")
      .sort((a, b) => (own.get(b.id) ?? 0) - (own.get(a.id) ?? 0))
      .slice(0, maxCallUps)
      .map((p) => p.id),
  );
  const movable = players.filter((p) => p.status === "ACTIVE" || p.status === "RESERVE" || callUps.has(p.id));
  const hit = new Map(movable.map((p) => [p.id, p.hit]));
  const start = new Set(movable.filter((p) => p.status !== "MINORS").map((p) => p.id));
  const minorsFixed = players.filter((p) => p.status === "MINORS").length - movable.filter((p) => p.status === "MINORS").length;
  const used = (s: ReadonlySet<string>) => [...s].reduce((a, id) => a + (hit.get(id) ?? 0), 0);
  const offBy = (s: ReadonlySet<string>) => {
    const u = used(s);
    const minors = movable.length - s.size + minorsFixed;
    return Math.max(0, u - rules.cap) + Math.max(0, rules.floor - u) + Math.max(0, s.size - rules.spots) * 10 + Math.max(0, minors - rules.maxMinors) * 10;
  };

  // The search sample: evenly spaced days, each standing for its share of all of them.
  const n = Math.min(searchDays, days.length);
  const idx = Array.from({ length: n }, (_, k) => Math.min(days.length - 1, Math.floor(((k + 0.5) * days.length) / Math.max(1, n))));
  const total = weights.reduce((a, b) => a + b, 0) || days.length;
  const sDays = idx.map((i) => days[i]!);
  const sWeights = idx.map(() => total / Math.max(1, n));

  const key = (s: ReadonlySet<string>) => [...s].sort().join();
  const sampled = new Map<string, number>();
  const score = (s: ReadonlySet<string>) => {
    const k = key(s);
    let v = sampled.get(k);
    if (v === undefined) {
      v = countedValue(s, sDays, sWeights, slots, order);
      sampled.set(k, v);
    }
    return v - PENALTY * offBy(s);
  };
  // Every roster a search steps through: the finalists.
  const finalists = new Map<string, Set<string>>();
  const search = (from: Set<string>) => {
    let cur = new Set(from);
    let curScore = score(cur);
    finalists.set(key(cur), cur);
    for (let it = 0; it < maxIter; it++) {
      let best: Set<string> | null = null;
      let bestScore = curScore + 1e-6;
      const out = [...cur];
      const inn = movable.map((p) => p.id).filter((id) => !cur.has(id));
      const tryMove = (next: Set<string>) => {
        const sc = score(next);
        if (sc > bestScore) {
          bestScore = sc;
          best = next;
        }
      };
      for (const x of out) {
        const nx = new Set(cur);
        nx.delete(x);
        tryMove(nx);
      }
      for (const y of inn) {
        const nx = new Set(cur);
        nx.add(y);
        tryMove(nx);
      }
      for (const x of out)
        for (const y of inn) {
          const nx = new Set(cur);
          nx.delete(x);
          nx.add(y);
          tryMove(nx);
        }
      if (!best) break;
      cur = best;
      curScore = bestScore;
      finalists.set(key(cur), cur);
    }
  };
  search(start);
  const byHand = capFitByHand(movable, rules, (id) => own.get(id) ?? 0);
  finalists.set(key(byHand), byHand);
  search(byHand);

  // Re-score the finalists on all the days; the roster as it is wins ties, then fewer moves.
  const moveCount = (s: ReadonlySet<string>) => [...s].filter((id) => !start.has(id)).length + [...start].filter((id) => !s.has(id)).length;
  const full = new Map<string, number>();
  const fullValue = (s: ReadonlySet<string>) => {
    const k = key(s);
    let v = full.get(k);
    if (v === undefined) {
      v = countedValue(s, days, weights, slots, order);
      full.set(k, v);
    }
    return v;
  };
  let cur = start;
  let curScore = fullValue(start) - PENALTY * offBy(start);
  for (const s of finalists.values()) {
    const sc = fullValue(s) - PENALTY * offBy(s);
    if (sc > curScore + 1e-6 || (Math.abs(sc - curScore) <= 1e-6 && moveCount(s) < moveCount(cur))) {
      cur = s;
      curScore = sc;
    }
  }

  const moves: CapFitMove[] = [];
  for (const p of movable) {
    if (start.has(p.id) && !cur.has(p.id)) moves.push({ id: p.id, to: "MINORS" });
    if (!start.has(p.id) && cur.has(p.id)) moves.push({ id: p.id, to: "RESERVE" });
  }
  const u = used(cur);
  const minors = movable.length - cur.size + minorsFixed;
  return {
    moves,
    usedBefore: used(start),
    usedAfter: u,
    before: fullValue(start),
    after: fullValue(cur),
    legal: u <= rules.cap + 1e-9 && u >= rules.floor - 1e-9 && cur.size <= rules.spots && minors <= rules.maxMinors,
  };
}

/**
 * The human rule the optimizer is measured against: the best `spots` by
 * season points; while over the cap, send down the counted player with the
 * fewest season points per M$ and call up the best Minors player who fits.
 */
export function capFitByHand(players: readonly CapFitPlayer[], rules: CapFitRules, seasonPoints: (id: string) => number): Set<string> {
  const movable = players.filter((p) => p.status === "ACTIVE" || p.status === "RESERVE" || p.status === "MINORS");
  const hit = new Map(movable.map((p) => [p.id, p.hit]));
  const ranked = [...movable].sort((a, b) => seasonPoints(b.id) - seasonPoints(a.id));
  const counted = new Set(ranked.slice(0, rules.spots).map((p) => p.id));
  const used = () => [...counted].reduce((a, id) => a + (hit.get(id) ?? 0), 0);
  for (let guard = 0; guard < 40 && used() > rules.cap + 1e-9; guard++) {
    const worst = [...counted].sort((a, b) => seasonPoints(a) / Math.max(0.5, hit.get(a)!) - seasonPoints(b) / Math.max(0.5, hit.get(b)!))[0]!;
    counted.delete(worst);
    const room = rules.cap - used();
    const up = ranked.find((p) => !counted.has(p.id) && p.id !== worst && p.hit <= room);
    if (up) counted.add(up.id);
  }
  return counted;
}

const NHL_SEASON_GAMES = 82;
/** Smallest gain (points over the rest of the season) worth a cap-fit move on a legal roster. */
export const CAP_FIT_MIN_GAIN = 5;

/**
 * A lineup candidate's odds on a season-long choice: a skater who is not a
 * regular dresses his projected share of the season (gp / 82), not the
 * nightly floor the lineup uses when he is in it tonight (the league prior's
 * 60 % for a prospect, 30 % for a fringe player). A prospect projected for
 * no NHL game is worth nothing — without this the fit called 0-game
 * prospects up for real NHL players. Goalies already play their projected
 * start share.
 */
export function seasonCandidate(
  c: LineupCandidate,
  values: ValuesSnapshot["players"],
  icons: Readonly<Record<string, string[]>>,
  priors: FantraxPriors,
): LineupCandidate {
  const rec = values[c.id];
  if (!rec || isGoalieRecord(rec)) return c;
  const ic = icons[c.id] ?? [];
  const nightly = skaterPlayProbability({ gp: rec.gp, fpg: bestFpg(rec), src: rec.src, team: rec.t, icons: ic }, true, priors);
  const dtd = dayToDayFactor(ic);
  if (nightly <= 0 || nightly >= dtd - 1e-9) return c;
  const k = Math.min(1, ((Math.max(0, rec.gp) / NHL_SEASON_GAMES) * dtd) / nightly);
  if (k >= 1) return c;
  const scaled: Partial<Record<SlotId, number>> = {};
  for (const [slot, v] of Object.entries(c.values) as Array<[SlotId, number | undefined]>) scaled[slot] = (v ?? 0) * k;
  return { ...c, values: scaled, games: (c.games ?? 0) * k };
}

export interface CapFitAdviceInput {
  /** Active, Reserve and Minors players (status as on the roster). */
  roster: ReadonlyArray<{ id: string; status: string }>;
  contracts: ContractsFile;
  rules: CapFitRules;
  /** Each lineup day left in the fantasy regular season: the roster's candidates (nightly values, any status). */
  days: readonly LineupCandidate[][];
  slots: SlotCounts;
  order: readonly SlotId[];
  values: ValuesSnapshot["players"];
  icons: Readonly<Record<string, string[]>>;
  priors: FantraxPriors;
  searchDays?: number;
}

/**
 * The plan's salary-cap advice (`DailyPlan.capFit`): the fit on season odds
 * (`seasonCandidate`), shown when it gains `CAP_FIT_MIN_GAIN` or makes an
 * illegal roster (over the cap, under the floor, more than the counted
 * spots) legal. Also returns what the fit saw, for the backtest.
 */
export function capFitAdvice(a: CapFitAdviceInput): {
  advice: DailyPlan["capFit"];
  result: CapFitResult;
  players: CapFitPlayer[];
  days: LineupCandidate[][];
} {
  const players = a.roster.map((r) => ({ id: r.id, status: r.status, hit: a.contracts.players[r.id]?.c[0] ?? a.contracts.min[0] ?? 0 }));
  const days = a.days.map((cands) =>
    cands.map((c) => seasonCandidate(c, a.values, a.icons, a.priors)).filter((c) => Object.values(c.values).some((v) => (v ?? 0) > 0)),
  );
  const result = capFit(players, a.rules, days, days.map(() => 1), a.slots, a.order, a.searchDays !== undefined ? { searchDays: a.searchDays } : {});
  const counted = players.filter((p) => p.status !== "MINORS").length;
  const legalBefore = result.usedBefore <= a.rules.cap + 1e-9 && result.usedBefore >= a.rules.floor - 1e-9 && counted <= a.rules.spots;
  const r2 = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
  const advice =
    result.moves.length && (result.after - result.before >= CAP_FIT_MIN_GAIN || !legalBefore)
      ? {
          moves: result.moves,
          usedBefore: r2(result.usedBefore, 2),
          usedAfter: r2(result.usedAfter, 2),
          gain: legalBefore ? r2(result.after - result.before, 1) : null,
          legal: result.legal,
        }
      : null;
  return { advice, result, players, days };
}
