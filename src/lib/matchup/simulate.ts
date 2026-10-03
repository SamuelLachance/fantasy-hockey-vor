/**
 * Weekly head-to-head categories matchup, simulated (Monte Carlo): two
 * fantasy rosters, the NHL games of each day of the week, daily lineups
 * (only the players seated in a starting slot on a day count; the rest of a
 * busy day's players sit on the bench), goalie starts drawn from each
 * goalie's share of his club's starts (two goalies of one club never both
 * start; a starter rarely starts both nights of a back-to-back), and the
 * league's weekly minimum of goalie appearances. Every count is drawn from a
 * negative binomial fitted on NHL box scores (`params.ts`); a goalie's
 * shots, goals against, shutout and win come from one start, so they stay
 * consistent (a shutout is a start with no goal against; the fewer goals
 * against, the likelier the win).
 *
 * Out: per category P(win / tie / loss) and the expected totals of both
 * sides; P(win the week), the expected categories won. Pure and seeded (the
 * same inputs give the same answer); no DOM, no fetch.
 */
import { mulberry32, hashStr, type Rng } from "../dynasty/rng";
import { fillSlots, type SlotSpec } from "../leagues/slot-fill";
import { MATCHUP_PARAMS, type MatchupParams } from "./params";

export const SKATER_CATS = ["G", "A", "PPP", "SOG", "HIT", "BLK"] as const;
export const GOALIE_CATS = ["W", "GAA", "SVP", "SHO"] as const;
export const CATS = [...SKATER_CATS, ...GOALIE_CATS] as const;
export type MatchupCat = (typeof CATS)[number];
/** Lower is better. */
export const LOWER_BETTER: ReadonlySet<MatchupCat> = new Set(["GAA"]);

export interface SimSkater {
  id: number;
  name: string;
  /** NHL club (schedule key). */
  team: string;
  /** Yahoo positions: C, LW, RW, D. */
  pos: readonly string[];
  /** Per game: G, A, PPP, SOG, HIT, BLK. */
  rate: readonly [number, number, number, number, number, number];
  /** P(he dresses for one of his club's games); default `params.skaterPlays`. */
  play?: number;
  /** Lineup priority (higher sits first on a busy day). */
  prio: number;
}

export interface SimGoalie {
  id: number;
  name: string;
  team: string;
  /** Share of his club's games he starts. */
  start: number;
  /** Per start: wins, goals against, shots against. */
  w: number;
  ga: number;
  sa: number;
  prio: number;
}

export interface SimTeam {
  skaters: readonly SimSkater[];
  goalies: readonly SimGoalie[];
  /** Stop starting goalies once this many appearances are in (Infinity = always start them). */
  goalieCap?: number;
  /**
   * The week so far (days already played), in the simulator's totals:
   * G A PPP SOG HIT BLK W GA SA SHO appearances (`baseTotals`).
   */
  base?: readonly number[];
}

/**
 * The week so far as the simulator counts it, from what the platform shows:
 * the six skater counts, wins, shutouts, appearances, GAA and SV% (goals
 * against = GAA × appearances, shots against = goals against ÷ (1 − SV%)).
 */
export function baseTotals(x: {
  G: number; A: number; PPP: number; SOG: number; HIT: number; BLK: number;
  W: number; SHO: number; apps: number; gaa: number; svp: number;
}): number[] {
  const ga = Math.max(0, x.gaa) * Math.max(0, x.apps);
  const sa = x.svp > 0 && x.svp < 1 ? ga / (1 - x.svp) : ga > 0 ? ga * 10 : x.apps * 28;
  return [x.G, x.A, x.PPP, x.SOG, x.HIT, x.BLK, x.W, ga, sa, x.SHO, x.apps].map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
}

export interface SimDay {
  /** YYYY-MM-DD (league time). */
  date: string;
  /** NHL clubs playing that day. */
  teams: ReadonlySet<string>;
  /** Clubs that also played the day before (back-to-back second night). */
  b2b?: ReadonlySet<string>;
}

export type SlotCounts = Readonly<Record<string, number>>;

export interface SimLeague {
  /** Skater starting slots and the positions each takes. */
  slots: SlotCounts;
  eligibility: Readonly<Record<string, readonly string[]>>;
  /** Goalie starting slots. */
  goalieSlots: number;
  /** Weekly minimum of goalie appearances (below it, GAA and SV% are lost). */
  minGoalieApps: number;
}

export const LTL_LEAGUE: SimLeague = {
  slots: { C: 2, LW: 2, RW: 2, F: 1, D: 4, Util: 1 },
  eligibility: { C: ["C"], LW: ["LW"], RW: ["RW"], F: ["C", "LW", "RW"], D: ["D"], Util: ["C", "LW", "RW", "D"] },
  goalieSlots: 2,
  minGoalieApps: 4,
};

export interface CatOdds {
  cat: MatchupCat;
  win: number;
  tie: number;
  loss: number;
  /** Expected weekly value (counts; GAA and SV% as ratios over the sims where defined). */
  mine: number;
  theirs: number;
}

export interface SimResult {
  sims: number;
  cats: CatOdds[];
  /** P(more categories won than lost). */
  win: number;
  tie: number;
  /** Expected categories won (a tie counts ½). */
  expCats: number;
  /** Distribution of categories won (0 … 10, ties ½ rounded down). */
  catsWonDist: number[];
  /** Expected goalie appearances, and P(reaching the minimum). */
  apps: { mine: number; theirs: number; pMinMine: number; pMinTheirs: number };
  /** Expected seated games of each skater (by id), both sides. */
  games: Map<number, number>;
}

// ---------------------------------------------------------------- variates

/** Gamma(shape k, scale 1) (Marsaglia-Tsang; k < 1 boosted). */
export function gamma(rng: Rng, k: number): number {
  if (k < 1) return gamma(rng, k + 1) * Math.pow(rng.u() || 1e-12, 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x = 0;
    let v = 0;
    do {
      x = rng.n();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.u();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u || 1e-300) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Poisson(λ): inversion below 30, rounded normal above (weekly player counts stay small). */
export function poisson(rng: Rng, lambda: number): number {
  if (!(lambda > 0)) return 0;
  if (lambda >= 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * rng.n()));
  let k = 0;
  let p = Math.exp(-lambda);
  let s = p;
  const u = rng.u();
  while (u > s && k < 200) {
    k++;
    p *= lambda / k;
    s += p;
  }
  return k;
}

/** Negative binomial with mean μ and shape r (r = Infinity: Poisson). */
export function negBin(rng: Rng, mu: number, r: number): number {
  if (!(mu > 0)) return 0;
  if (!Number.isFinite(r)) return poisson(rng, mu);
  return poisson(rng, (mu * gamma(rng, r)) / r);
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** P(GA = g) of one start under the model (NB in shots, NB-mixed rate), g = 0 … 15, by quadrature-free MC-free approximation. */
function gaPmf(ga: number, kq: number, maxG = 15): number[] {
  // GA per start ≈ NB(mean ga, shape kq) (the shot count's own noise is
  // small next to the save% noise); pmf by the NB recursion.
  const r = Number.isFinite(kq) ? kq : 1e6;
  const p = r / (r + ga);
  const out: number[] = [];
  let f = Math.pow(p, r);
  for (let g = 0; g <= maxG; g++) {
    out.push(f);
    f *= ((g + r) / (g + 1)) * (1 - p);
  }
  return out;
}

/** The intercept a with E[sigmoid(a + b·GA)] = w (bisection). */
export function winIntercept(w: number, ga: number, params: MatchupParams = MATCHUP_PARAMS): number {
  const pmf = gaPmf(ga, params.kSavePct);
  const target = Math.min(0.95, Math.max(0.02, w));
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 50; i++) {
    const a = (lo + hi) / 2;
    let e = 0;
    pmf.forEach((q, g) => (e += q * sigmoid(a + params.winSlope * g)));
    if (e < target) lo = a;
    else hi = a;
  }
  return (lo + hi) / 2;
}

// ---------------------------------------------------------------- the week

interface Prepared {
  days: Array<{
    /** Skaters of each side whose club plays, best first. */
    sk: [SimSkater[], SimSkater[]];
    /** Every club playing that day, sorted (one start draw each, whoever holds its goalies). */
    allClubs: string[];
    b2b: ReadonlySet<string> | undefined;
  }>;
  slots: SlotSpec<string>[];
  winA: Map<number, number>;
}

function prepare(a: SimTeam, b: SimTeam, days: readonly SimDay[], league: SimLeague, params: MatchupParams): Prepared {
  const slots: SlotSpec<string>[] = Object.entries(league.slots)
    .filter(([, n]) => n > 0)
    .map(([slot, n]) => ({ slot, capacity: n, accepts: league.eligibility[slot] ?? [] }));
  const order = (xs: readonly SimSkater[]) => [...xs].sort((x, y) => y.prio - x.prio || x.id - y.id);
  const sa = order(a.skaters);
  const sb = order(b.skaters);
  const winA = new Map<number, number>();
  for (const g of [...a.goalies, ...b.goalies]) winA.set(g.id, winIntercept(g.w, g.ga, params));
  return {
    days: days.map((d) => ({
      sk: [sa.filter((s) => d.teams.has(s.team)), sb.filter((s) => d.teams.has(s.team))],
      allClubs: [...d.teams].sort(),
      b2b: d.b2b,
    })),
    slots,
    winA,
  };
}

/** One side's weekly totals: G A PPP SOG HIT BLK W GA SA SHO apps. */
export const T_LEN = 11;

/**
 * Simulate the week. `sims` draws (2,000 by default: P(win) to about ±1 %).
 */
export function simulateWeek(
  a: SimTeam,
  b: SimTeam,
  days: readonly SimDay[],
  opts: { sims?: number; seed?: string; league?: SimLeague; params?: MatchupParams } = {},
): SimResult {
  const sims = opts.sims ?? 2000;
  const league = opts.league ?? LTL_LEAGUE;
  const params = opts.params ?? MATCHUP_PARAMS;
  const prep = prepare(a, b, days, league, params);
  const totals = runSims(a, b, prep, league, params, opts.seed ?? "", sims);
  return summarize(totals, sims, league, prep, a, b);
}

/** Raw per-sim totals of both sides (exported for the streaming search, which reuses the opponent's draws). */
export interface RawSims {
  /** [sim][side][T_LEN] flattened: (s * 2 + side) * T_LEN + k. */
  t: Float64Array;
  /** Seated games per skater id, summed over sims. */
  games: Map<number, number>;
}

export function runSims(
  a: SimTeam,
  b: SimTeam,
  prep: Prepared,
  league: SimLeague,
  params: MatchupParams,
  seed: string,
  sims: number,
): RawSims {
  const t = new Float64Array(sims * 2 * T_LEN);
  const games = new Map<number, number>();
  const sides = [a, b] as const;
  // goalies of each club, both sides (a club's start is one draw)
  const clubGoalies = new Map<string, Array<{ g: SimGoalie; side: 0 | 1 }>>();
  sides.forEach((tm, side) => {
    for (const g of tm.goalies) {
      const l = clubGoalies.get(g.team) ?? [];
      l.push({ g, side: side as 0 | 1 });
      clubGoalies.set(g.team, l);
    }
  });
  // Common random numbers: every player draws from his own stream and every
  // club's start from the clubs' stream, so a roster change on one side
  // leaves the other side's draws (and every unmoved player's) untouched.
  const base = hashStr(`matchup|${seed}`);
  const pSeed = new Map<number, number>();
  for (const tm of sides) for (const p of [...tm.skaters, ...tm.goalies]) pSeed.set(p.id, hashStr(`${base}|${p.id}`));
  const streamOf = (id: number, s: number) => mulberry32((pSeed.get(id)! ^ Math.imul(s + 1, 0x9e3779b1)) >>> 0);
  const seated = [new Map<number, number>(), new Map<number, number>()];
  const rngs = new Map<number, Rng>();
  // the week's true rates around the projection (params.kRate*): one draw per player per sim, first in his stream
  const mult = (r: Rng, k: number) => (Number.isFinite(k) ? gamma(r, k) / k : 1);
  const mOff = new Map<number, number>();
  const mPer = new Map<number, number>();
  const mGa = new Map<number, number>();
  for (let s = 0; s < sims; s++) {
    seated[0]!.clear();
    seated[1]!.clear();
    rngs.clear();
    for (const tm of sides) {
      for (const p of tm.skaters) {
        const r = streamOf(p.id, s);
        rngs.set(p.id, r);
        mOff.set(p.id, mult(r, params.kRateOffense));
        mPer.set(p.id, mult(r, params.kRatePeripheral));
      }
      for (const g of tm.goalies) {
        const r = streamOf(g.id, s);
        rngs.set(g.id, r);
        mGa.set(g.id, mult(r, params.kRateGoalie));
      }
    }
    const clubRng = mulberry32((base ^ Math.imul(s + 1, 0x85ebca6b)) >>> 0);
    const apps = [0, 0];
    sides.forEach((tm, side) => {
      if (!tm.base) return;
      const o = (s * 2 + side) * T_LEN;
      for (let k = 0; k < T_LEN; k++) t[o + k] += tm.base[k] ?? 0;
      apps[side] = tm.base[10] ?? 0;
    });
    for (const day of prep.days) {
      // ---- skaters: who dresses (his own stream), then who gets a seat
      for (let side = 0; side < 2; side++) {
        const list = day.sk[side]!;
        if (!list.length) continue;
        const dressed = list.filter((p) => rngs.get(p.id)!.u() < (p.play ?? params.skaterPlays));
        if (!dressed.length) continue;
        const fill = fillSlots<number, { id: number; positions: readonly string[] }, string>(
          dressed.map((p) => ({ id: p.id, positions: p.pos })),
          prep.slots,
        );
        for (const id of fill.slotOf.keys()) seated[side]!.set(id, (seated[side]!.get(id) ?? 0) + 1);
      }
      // ---- goalies: one start draw per club playing (every club, fixed order)
      const starters: SimGoalie[][] = [[], []];
      for (const club of day.allClubs) {
        let u = clubRng.u();
        const list = clubGoalies.get(club);
        if (!list) continue;
        for (const { g, side } of list) {
          let share = g.start;
          if (day.b2b?.has(club) && share > 0.5) share *= params.backToBackStart;
          if (u < share) {
            starters[side]!.push(g);
            break;
          }
          u -= share;
        }
      }
      for (let side = 0; side < 2; side++) {
        const cap = sides[side]!.goalieCap ?? Infinity;
        const st = starters[side]!.sort((x, y) => y.prio - x.prio || x.id - y.id);
        for (let i = 0; i < Math.min(st.length, league.goalieSlots); i++) {
          if (apps[side]! >= cap) break;
          const g = st[i]!;
          const r = rngs.get(g.id)!;
          apps[side]!++;
          const o = (s * 2 + side) * T_LEN;
          const shots = negBin(r, g.sa, params.kShotsAgainst);
          const q = g.sa > 0 ? g.ga / g.sa : 0.1;
          const qm = (Number.isFinite(params.kSavePct) ? gamma(r, params.kSavePct) / params.kSavePct : 1) * mGa.get(g.id)!;
          const ga = Math.min(shots, poisson(r, shots * q * qm));
          t[o + 6] += r.u() < sigmoid(prep.winA.get(g.id)! + params.winSlope * ga) ? 1 : 0;
          t[o + 7] += ga;
          t[o + 8] += shots;
          t[o + 9] += ga === 0 ? 1 : 0;
          t[o + 10] += 1;
        }
      }
    }
    // ---- skater stat lines over their seated games
    for (let side = 0; side < 2; side++) {
      const o = (s * 2 + side) * T_LEN;
      for (const p of sides[side]!.skaters) {
        const n = seated[side]!.get(p.id) ?? 0;
        if (!n) continue;
        const r = rngs.get(p.id)!;
        games.set(p.id, (games.get(p.id) ?? 0) + n);
        const m = (Number.isFinite(params.kOffense) ? gamma(r, n * params.kOffense) / (n * params.kOffense) : 1) * mOff.get(p.id)!;
        const mp = mPer.get(p.id)!;
        t[o] += poisson(r, n * p.rate[0] * m);
        t[o + 1] += poisson(r, n * p.rate[1] * m);
        t[o + 2] += poisson(r, n * p.rate[2] * m);
        t[o + 3] += negBin(r, n * p.rate[3] * mp, n * params.kShots);
        t[o + 4] += negBin(r, n * p.rate[4] * mp, n * params.kHits);
        t[o + 5] += negBin(r, n * p.rate[5] * mp, n * params.kBlocks);
      }
    }
  }
  return { t, games };
}

/** Category values of one side in one sim (GAA, SV% NaN without an appearance). */
export function catValues(t: Float64Array, o: number): number[] {
  const apps = t[o + 10]!;
  const ga = t[o + 7]!;
  const sa = t[o + 8]!;
  return [t[o]!, t[o + 1]!, t[o + 2]!, t[o + 3]!, t[o + 4]!, t[o + 5]!, t[o + 6]!, apps > 0 ? ga / apps : NaN, sa > 0 ? (sa - ga) / sa : NaN, t[o + 9]!];
}

/**
 * Outcome of each category in one sim, from side A's view: 1 win, 0.5 tie,
 * 0 loss. Below the minimum of goalie appearances a side loses GAA and SV%
 * (both below: a tie); a side without an appearance has neither.
 */
export function catOutcomes(t: Float64Array, s: number, league: SimLeague): number[] {
  const va = catValues(t, s * 2 * T_LEN);
  const vb = catValues(t, (s * 2 + 1) * T_LEN);
  const okA = t[s * 2 * T_LEN + 10]! >= league.minGoalieApps;
  const okB = t[(s * 2 + 1) * T_LEN + 10]! >= league.minGoalieApps;
  return CATS.map((cat, i) => {
    if (cat === "GAA" || cat === "SVP") {
      if (!okA && !okB) return 0.5;
      if (!okA) return 0;
      if (!okB) return 1;
    }
    const x = va[i]!;
    const y = vb[i]!;
    if (Number.isNaN(x) && Number.isNaN(y)) return 0.5;
    if (Number.isNaN(x)) return 0;
    if (Number.isNaN(y)) return 1;
    const d = LOWER_BETTER.has(cat) ? y - x : x - y;
    return Math.abs(d) < 1e-9 ? 0.5 : d > 0 ? 1 : 0;
  });
}

function summarize(raw: RawSims, sims: number, league: SimLeague, _prep: Prepared, _a: SimTeam, _b: SimTeam): SimResult {
  const { t } = raw;
  const win = new Array<number>(CATS.length).fill(0);
  const tie = new Array<number>(CATS.length).fill(0);
  const sumA = new Array<number>(CATS.length).fill(0);
  const sumB = new Array<number>(CATS.length).fill(0);
  const nA = new Array<number>(CATS.length).fill(0);
  const nB = new Array<number>(CATS.length).fill(0);
  const dist = new Array<number>(CATS.length + 1).fill(0);
  let wWeek = 0;
  let tWeek = 0;
  let exp = 0;
  let appsA = 0;
  let appsB = 0;
  let minA = 0;
  let minB = 0;
  for (let s = 0; s < sims; s++) {
    const out = catOutcomes(t, s, league);
    let won = 0;
    let lost = 0;
    out.forEach((x, i) => {
      if (x === 1) {
        win[i]!++;
        won++;
      } else if (x === 0.5) tie[i]!++;
      else lost++;
      exp += x;
    });
    dist[won]!++;
    if (won > lost) wWeek++;
    else if (won === lost) tWeek++;
    const va = catValues(t, s * 2 * T_LEN);
    const vb = catValues(t, (s * 2 + 1) * T_LEN);
    va.forEach((x, i) => {
      if (!Number.isNaN(x)) {
        sumA[i]! += x;
        nA[i]!++;
      }
    });
    vb.forEach((x, i) => {
      if (!Number.isNaN(x)) {
        sumB[i]! += x;
        nB[i]!++;
      }
    });
    const ap = t[s * 2 * T_LEN + 10]!;
    const bp = t[(s * 2 + 1) * T_LEN + 10]!;
    appsA += ap;
    appsB += bp;
    if (ap >= league.minGoalieApps) minA++;
    if (bp >= league.minGoalieApps) minB++;
  }
  const games = new Map<number, number>();
  for (const [id, n] of raw.games) games.set(id, n / sims);
  return {
    sims,
    cats: CATS.map((cat, i) => ({
      cat,
      win: win[i]! / sims,
      tie: tie[i]! / sims,
      loss: 1 - (win[i]! + tie[i]!) / sims,
      mine: nA[i]! ? sumA[i]! / nA[i]! : NaN,
      theirs: nB[i]! ? sumB[i]! / nB[i]! : NaN,
    })),
    win: wWeek / sims,
    tie: tWeek / sims,
    expCats: exp / sims,
    catsWonDist: dist.map((x) => x / sims),
    apps: { mine: appsA / sims, theirs: appsB / sims, pMinMine: minA / sims, pMinTheirs: minB / sims },
    games,
  };
}

/** The pieces `stream.ts` re-runs with one side changed. */
export const _internal = { prepare, T_LEN };
