/**
 * Slapshot Fantasy League (Fantrax glxjunc7mtxdqi8x) profile for the dynasty
 * engine: 32 teams, head-to-head points, C4 LW4 RW4 D6 G2 + 3 reserve, 17
 * minors (any player), IR 5, 40 max; every player carries over (no cutdown,
 * no minors eligibility rule, no captain) and a commissioner salary cap on
 * the 23 active + reserve players (real NHL cap hits; minors and IR free).
 *
 * The engine's level θ stays on league 1's realized scale (aging, growth,
 * retention and goalie roles are fitted there); a player's Slapshot season
 * value converts it with his own scoring ratio k (Slapshot FP/G ÷ league-1
 * FP/G of the same projection, × the share of NHL games played inside the
 * fantasy season), against Slapshot replacement levels from an optimal
 * seat-by-seat fill of the league's 640 starting seats, less the cap charge
 * λ_t × (cap hit_t − league minimum). Each season the owner plays him or
 * stashes him in the minors (0 points, 0 cap): gain = max(0, value − charge).
 *
 * Pure: no fs; the build script (scripts/dynasty-slapshot.ts) passes data in.
 */
import { fillSlots, type SlotSpec } from "../leagues/slot-fill";
import type { Position } from "../types";
import type { LevelFn } from "./aging";
import type { DynastyParams } from "./params";
import { rngFor } from "./rng";
import type { Routed } from "./segment";
import type { SimLeague } from "./simulate";
import type { DynastyRecord, Group, Mode } from "./types";
import { MODES } from "./types";

export type SlapPos = "C" | "LW" | "RW" | "D" | "G";
export const SLAP_POS: readonly SlapPos[] = ["C", "LW", "RW", "D", "G"];

interface Sourced {
  source: string;
}

/** src/data/dynasty/slapshot/league.json */
export interface SlapshotProfile {
  version: string;
  source: string;
  league: { id: string; name: string; teams: number; userTeam: string };
  scoring: Sourced & {
    skater: { G: number; A: number; PPP: number; SHG: number; SOG: number; Hit: number; SB: number };
    goalie: { W: number; SV: number; GA: number; SHO: number; A: number };
    /** Short-handed goals per goal (players.json has no SHG). */
    shgPerGoal: { F: number; D: number };
    goalieAssistsPerGame: number;
  };
  roster: Sourced & { active: Record<SlapPos, number>; reserve: number; ir: number; minors: number; max: number };
  season: Sourced & { fantasyShare: number };
  cap: Sourced & {
    /** League cap in the first season, M$. */
    base: number;
    /** NHL upper limit by start year, M$ (announced). */
    nhl: Record<string, number>;
    /** NHL cap growth per season after the last announced one. */
    growthAfter: number;
    /** NHL minimum salary in the first season, M$ (grows with the cap). */
    minSalary: number;
    /** Entry-level cap hit assumed for a prospect without a contract, M$. */
    elcCapHit: number;
    elcYears: number;
    /** Cap hits at or below this (M$) count as the minimum (two-way / ELC floor). */
  };
  lambda: Sourced & {
    /** "snake": mean per-team shadow price after a snake allocation (no trades); "aggregate": league-wide Lagrangian; "fixed". */
    method: "snake" | "aggregate" | "fixed";
    fixed: number;
    /** Seasons whose λ comes from their own pool; later seasons hold the last one per share of the cap. */
    solvedSeasons?: number;
  };
  replacement: Sourced & { unseatedAvg: number; goalieUnseatedAvg: number };
  contracts: Sourced & {
    /** Term of a projected new contract by age at signing: [max age, years]. */
    termByAge: Array<[number, number]>;
    ufaAge: number;
    /** Projected AAV bounds, share of the NHL cap (oldMaxPct from signing age oldAge). */
    minPct: number;
    maxPct: number;
    oldAge: number;
    oldMaxPct: number;
  };
}

export function parseSlapshotProfile(raw: unknown): SlapshotProfile {
  const p = raw as SlapshotProfile;
  for (const k of ["league", "scoring", "roster", "season", "cap", "lambda", "replacement", "contracts"] as const) {
    if (!p || typeof p !== "object" || !p[k]) throw new Error(`slapshot league.json: missing block ${k}`);
  }
  return p;
}

// ---------------------------------------------------------------- scoring

export interface SkaterLine {
  gp: number;
  goals: number;
  assists: number;
  shots: number;
  ppp: number;
}
export interface GoalieLine {
  gp: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
}

/** Slapshot FP per game from a skater's projected season (SHG estimated from goals). */
export function skaterFpg(prof: SlapshotProfile, g: "F" | "D", s: SkaterLine): number {
  if (!(s.gp > 0)) return 0;
  const k = prof.scoring.skater;
  const shg = prof.scoring.shgPerGoal[g] * s.goals;
  return (k.G * s.goals + k.A * s.assists + k.PPP * s.ppp + k.SHG * shg + k.SOG * s.shots) / s.gp;
}

/** Slapshot FP per goalie game: GA = saves × (1 − sv%) / sv%; assists at the league rate. */
export function goalieFpg(prof: SlapshotProfile, s: GoalieLine): number {
  if (!(s.gp > 0)) return 0;
  const k = prof.scoring.goalie;
  const ga = s.savePct > 0 && s.savePct < 1 ? (s.saves * (1 - s.savePct)) / s.savePct : 0;
  return (k.W * s.wins + k.SV * s.saves + k.GA * ga + k.SHO * s.shutouts) / s.gp + k.A * prof.scoring.goalieAssistsPerGame;
}

// ---------------------------------------------------------------- cap

export interface CapSeries {
  /** NHL upper limit per season t, M$. */
  nhl: number[];
  /** League cap per season t, M$ (base × NHL_t / NHL_0). */
  league: number[];
  /** League minimum salary per season t, M$. */
  min: number[];
}

export function capSeries(prof: SlapshotProfile, y0: number, T: number): CapSeries {
  const nhl: number[] = [];
  for (let t = 0; t < T; t++) {
    const y = y0 + t;
    const known = prof.cap.nhl[String(y)];
    nhl.push(known ?? nhl[t - 1]! * (1 + prof.cap.growthAfter));
  }
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    nhl: nhl.map(r),
    league: nhl.map((x) => r((prof.cap.base * x) / nhl[0]!)),
    min: nhl.map((x) => r((prof.cap.minSalary * x) / nhl[0]!)),
  };
}

/**
 * NHL cap of a start year (announced, or grown from the last announced). A
 * year before the table throws: the earliest listed cap once stood in for
 * 2023-24 and 2024-25 (95.5 for 83.5 and 88.0), understating those
 * contracts' share of the cap by 13 % and 8 %.
 */
export function nhlCapOf(prof: SlapshotProfile, year: number): number {
  const years = Object.keys(prof.cap.nhl).map(Number).sort((a, b) => a - b);
  if (prof.cap.nhl[String(year)] != null) return prof.cap.nhl[String(year)]!;
  if (year < years[0]!) throw new Error(`slapshot league.json cap.nhl has no ${year} (earliest ${years[0]})`);
  const last = years[years.length - 1]!;
  return prof.cap.nhl[String(last)]! * Math.pow(1 + prof.cap.growthAfter, year - last);
}

// ---------------------------------------------------------------- salary model

/** One current contract as a training row for the next-AAV model. */
export interface SalaryRow {
  g: Group;
  /** AAV / NHL cap of its first season. */
  pct: number;
  /** Age at signing. */
  age: number;
  /** Realized level now (league-1 scale; goalies per start). */
  theta: number;
  /** Projected share of a season (goalies: starts). */
  share: number;
  /** Signed as a restricted free agent (his previous contract ended RFA). */
  rfa: boolean;
}

export interface SalaryModel {
  /**
   * Poisson pseudo-maximum likelihood on the AAV share (log link): exp(x·β)
   * is the conditional MEAN share, so r2 / rmse are on the share scale.
   */
  fit: "ppml";
  skater: { beta: number[]; features: string[]; n: number; r2: number; rmse: number };
  goalie: { beta: number[]; features: string[]; n: number; r2: number; rmse: number };
}

/**
 * Hinge knots in the level θ (league-1 realized scale): the market pays the
 * top of the league convexly (a log-linear fit ran half the real deals in
 * the top decile: MacKinnon 13.2 % of the cap against 6.0 % predicted). F
 * 2.3 / 3.2 ≈ the 80th / 93rd percentile of the forwards' contract rows, D
 * 1.8 / 2.4 ≈ the 70th / 90th of the defensemen's, G 2.5 ≈ the 90th of
 * θ × share.
 */
const KNOTS = { F: [2.3, 3.2], D: [1.8, 2.4], G: 2.5 } as const;

const SK_FEATURES = [
  "1",
  "D",
  "ln theta",
  "D x ln theta",
  "RFA",
  "max(0, 26 - age)",
  "max(0, age - 30)",
  "max(0, age - 34)",
  "ln share",
  "F x max(0, ln theta - ln 2.3)",
  "F x max(0, ln theta - ln 3.2)",
  "D x max(0, ln theta - ln 1.8)",
  "D x max(0, ln theta - ln 2.4)",
];
const G_FEATURES = [
  "1",
  "ln(theta x share)",
  "RFA",
  "max(0, 26 - age)",
  "max(0, age - 30)",
  "max(0, age - 34)",
  "max(0, ln(theta x share) - ln 2.5)",
];

const hinge = (x: number, knot: number) => Math.max(0, x - Math.log(knot));

function skaterX(r: Omit<SalaryRow, "pct">): number[] {
  const d = r.g === "D" ? 1 : 0;
  const f = 1 - d;
  const lt = Math.log(Math.max(0.3, r.theta));
  return [
    1,
    d,
    lt,
    d * lt,
    r.rfa ? 1 : 0,
    Math.max(0, 26 - r.age),
    Math.max(0, r.age - 30),
    Math.max(0, r.age - 34),
    Math.log(Math.max(0.1, Math.min(1, r.share))),
    f * hinge(lt, KNOTS.F[0]),
    f * hinge(lt, KNOTS.F[1]),
    d * hinge(lt, KNOTS.D[0]),
    d * hinge(lt, KNOTS.D[1]),
  ];
}
function goalieX(r: Omit<SalaryRow, "pct">): number[] {
  const lx = Math.log(Math.max(0.2, r.theta * Math.max(0.05, Math.min(1, r.share))));
  return [1, lx, r.rfa ? 1 : 0, Math.max(0, 26 - r.age), Math.max(0, r.age - 30), Math.max(0, r.age - 34), hinge(lx, KNOTS.G)];
}

/** Ridge-stabilized weighted least squares by normal equations (Gauss–Jordan); no weights = OLS. */
function wls(X: number[][], y: number[], w: number[] | null, ridge = 1e-4): number[] {
  const k = X[0]!.length;
  const A = Array.from({ length: k }, () => new Array<number>(k + 1).fill(0));
  let W = 0;
  for (let i = 0; i < X.length; i++) {
    const x = X[i]!;
    const wi = w ? w[i]! : 1;
    W += wi;
    for (let a = 0; a < k; a++) {
      for (let b = 0; b < k; b++) A[a]![b]! += wi * x[a]! * x[b]!;
      A[a]![k]! += wi * x[a]! * y[i]!;
    }
  }
  for (let a = 1; a < k; a++) A[a]![a]! += ridge * W;
  for (let c = 0; c < k; c++) {
    let piv = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
    [A[c], A[piv]] = [A[piv]!, A[c]!];
    const d = A[c]![c]!;
    for (let j = c; j <= k; j++) A[c]![j]! /= d;
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = A[r]![c]!;
      if (f) for (let j = c; j <= k; j++) A[r]![j]! -= f * A[c]![j]!;
    }
  }
  return A.map((row) => row[k]!);
}

/**
 * Poisson pseudo-maximum likelihood (log link) by iteratively reweighted
 * least squares from the log-OLS start: E[pct | x] = exp(x·β) directly, so
 * nothing needs retransforming (the log fit's exp(x·β) is a median, and a
 * lognormal correction assumes one spread at every level).
 */
function ppml(X: number[][], pct: number[]): { beta: number[]; r2: number; rmse: number } {
  let beta = wls(X, pct.map(Math.log), null);
  for (let it = 0; it < 100; it++) {
    const eta = X.map((x) => x.reduce((s, v, j) => s + v * beta[j]!, 0));
    const mu = eta.map(Math.exp);
    const z = eta.map((e, i) => e + (pct[i]! - mu[i]!) / mu[i]!);
    const next = wls(X, z, mu);
    const step = Math.max(...next.map((b, j) => Math.abs(b - beta[j]!)));
    beta = next;
    if (step < 1e-10) break;
  }
  const mean = pct.reduce((s, v) => s + v, 0) / pct.length;
  let ssr = 0;
  let sst = 0;
  for (let i = 0; i < X.length; i++) {
    const f = Math.exp(X[i]!.reduce((s, v, j) => s + v * beta[j]!, 0));
    ssr += (pct[i]! - f) ** 2;
    sst += (pct[i]! - mean) ** 2;
  }
  return { beta, r2: sst > 0 ? 1 - ssr / sst : 0, rmse: Math.sqrt(ssr / Math.max(1, X.length)) };
}

/** AAV share of the NHL cap on level, role, age and RFA status (PPML), skaters and goalies apart. */
export function fitSalaryModel(rows: readonly SalaryRow[]): SalaryModel {
  const sk = rows.filter((r) => r.g !== "G");
  const go = rows.filter((r) => r.g === "G");
  const fs = ppml(sk.map(skaterX), sk.map((r) => r.pct));
  const fg = ppml(go.map(goalieX), go.map((r) => r.pct));
  return {
    fit: "ppml",
    skater: { beta: fs.beta, features: SK_FEATURES, n: sk.length, r2: fs.r2, rmse: fs.rmse },
    goalie: { beta: fg.beta, features: G_FEATURES, n: go.length, r2: fg.r2, rmse: fg.rmse },
  };
}

/**
 * Expected AAV as a share of the NHL cap of the signing season (the PPML
 * fit's conditional mean, exp(x·β)), clamped to the market's bounds. In
 * sample, actual / predicted (ratio of means) in the top level decile is
 * 0.99 for forwards and 1.00 for defensemen; the old log-OLS median ran
 * 2.08 and 1.77 there (every star's next deal projected at about half).
 */
export function predictCapPct(prof: SlapshotProfile, m: SalaryModel, x: Omit<SalaryRow, "pct">): number {
  const f = x.g === "G" ? m.goalie : m.skater;
  const X = x.g === "G" ? goalieX(x) : skaterX(x);
  const ln = X.reduce((s, v, j) => s + v * f.beta[j]!, 0);
  // the market's ceiling: the max contract share, lower for players signing at 30+
  const hi = x.age >= prof.contracts.oldAge ? prof.contracts.oldMaxPct : prof.contracts.maxPct;
  return Math.min(hi, Math.max(prof.contracts.minPct, Math.exp(ln)));
}

export function termAtAge(prof: SlapshotProfile, age: number): number {
  for (const [maxAge, years] of prof.contracts.termByAge) if (age <= maxAge) return years;
  return 1;
}

// ---------------------------------------------------------------- contract path

/**
 * A player's known NHL contract seasons, from capwages only: the profiles'
 * `contract` field lists a signed extension as the current cap hit, so it
 * never sets a season.
 */
export interface KnownContract {
  /** Cap hit by start year, M$. */
  seasons: Record<string, number>;
  /** Status when the last known contract ends. */
  exp: "UFA" | "RFA" | null;
  /** The current (2026-27) contract is an entry-level deal. */
  elc: boolean;
  source: "capwages" | "none";
}

export interface ContractPath {
  /** Cap hit per season t, M$ (known, then projected). */
  cap: number[];
  /** Seasons 0 … known − 1 are signed contracts. */
  known: number;
  /** First start year without a signed contract (null: signed through the horizon). */
  expiry: number | null;
  status: "UFA" | "RFA" | null;
  /** Projected AAV of the next contract, M$ (null when signed through the horizon). */
  nextAav: number | null;
  elc: boolean;
  source: KnownContract["source"];
}

/**
 * Cap hits over the horizon: the signed seasons as they are; then projected
 * contracts (AAV = predicted share of that season's NHL cap, from the
 * expected level at signing), each for termAtAge years. A prospect without
 * a contract has no cap hit before his expected arrival (no NHL contract; he
 * sits in the minors) and an entry-level deal from it.
 */
export function contractPath(
  prof: SlapshotProfile,
  model: SalaryModel,
  y0: number,
  T: number,
  pl: {
    g: Group;
    age0: number;
    known: KnownContract;
    /** Expected league-1 realized level per season t (0 when not in the NHL yet). */
    theta: number[];
    share: number;
    /** Expected first NHL season (prospects), else y0. */
    arrival: number;
    /** No NHL contract yet and not an established player: an entry-level deal from his arrival. */
    rookie?: boolean;
  },
): ContractPath {
  const cap = new Array<number>(T).fill(0);
  let t = 0;
  while (t < T && pl.known.seasons[String(y0 + t)] != null) {
    cap[t] = pl.known.seasons[String(y0 + t)]!;
    t++;
  }
  const known = t;
  // a gap season inside the known years does not happen in capwages data; stop at the first missing one
  let status: "UFA" | "RFA" | null = pl.known.exp;
  let expiry: number | null = t < T ? y0 + t : null;
  let nextAav: number | null = null;
  let nextStatus: "UFA" | "RFA" | null = null;
  let elc = pl.known.elc;
  if (known === 0 && pl.rookie) {
    // unsigned prospect: no NHL contract, so no cap hit, before his
    // expected arrival (he sits in the minors); an entry-level deal from it
    elc = pl.arrival <= y0;
    const a = Math.min(T, Math.max(0, pl.arrival - y0));
    for (; t < a; t++) cap[t] = 0;
    for (let j = 0; j < prof.cap.elcYears && t < T; j++, t++) cap[t] = prof.cap.elcCapHit;
    status = "RFA";
    expiry = t < T ? y0 + t : null;
  }
  while (t < T) {
    const age = pl.age0 + t - 0.25;
    const st: "UFA" | "RFA" = status === "RFA" && age < prof.contracts.ufaAge ? "RFA" : age >= prof.contracts.ufaAge ? "UFA" : (status ?? "RFA");
    const th = pl.theta[Math.max(0, t - 1)] ?? pl.theta[0] ?? 0;
    const pct = predictCapPct(prof, model, { g: pl.g, age, theta: Math.max(0.3, th), share: pl.share, rfa: st === "RFA" });
    const aav = Math.round(pct * nhlCapOf(prof, y0 + t) * 1000) / 1000;
    if (nextAav == null) {
      nextAav = aav;
      nextStatus = st;
    }
    const term = termAtAge(prof, age);
    for (let j = 0; j < term && t < T; j++, t++) cap[t] = aav;
    status = pl.age0 + t - 0.25 >= prof.contracts.ufaAge ? "UFA" : "RFA";
  }
  return { cap, known, expiry, status: nextStatus ?? pl.known.exp, nextAav, elc, source: pl.known.source };
}

// ---------------------------------------------------------------- replacement and λ

export interface SeatPlayer {
  id: string;
  pos: SlapPos[];
  /** Expected season points (league scoring, fantasy season). */
  fp: number;
  /** Cap hit this season, M$. */
  cap: number;
}

const SEAT_ORDER: SlapPos[] = ["C", "LW", "RW", "D", "G"];

function seatSpecs(prof: SlapshotProfile): SlotSpec<SlapPos>[] {
  return SEAT_ORDER.map((s) => ({ slot: s, capacity: prof.roster.active[s] * prof.league.teams, accepts: [s as Position] }));
}

interface NumPlayer {
  id: number;
  positions: Position[];
  p: SeatPlayer;
}

/** Optimal league-wide seat fill (transversal matroid greedy, slot-fill.ts) by a value. */
export function seatFill(prof: SlapshotProfile, players: readonly SeatPlayer[], value: (p: SeatPlayer) => number) {
  const ordered: NumPlayer[] = [...players]
    .filter((p) => p.pos.length)
    .sort((a, b) => value(b) - value(a) || a.id.localeCompare(b.id))
    .map((p, i) => ({ id: i, positions: p.pos as Position[], p }));
  const res = fillSlots(ordered, seatSpecs(prof));
  const seated = new Set<string>();
  for (const [, list] of res.bySlot) for (const x of list) seated.add(x.p.id);
  return { seated, unseated: res.unassigned.map((x) => x.p), bySlot: res.bySlot };
}

export interface Replacement {
  /** Season points of the replacement at each position (mean of the best unseated). */
  season: Record<SlapPos, number>;
  /** Skaters: per NHL game (season ÷ a regular's games); goalies: per season slot. */
  perGame: Record<Exclude<SlapPos, "G">, number>;
  G: number;
}

export function replacementLevels(prof: SlapshotProfile, players: readonly SeatPlayer[], regularGames: number): Replacement {
  const { unseated } = seatFill(prof, players, (p) => p.fp);
  const season = {} as Record<SlapPos, number>;
  for (const pos of SLAP_POS) {
    const n = pos === "G" ? prof.replacement.goalieUnseatedAvg : prof.replacement.unseatedAvg;
    const best = unseated.filter((p) => p.pos.includes(pos)).slice(0, n);
    season[pos] = best.length ? best.reduce((s, p) => s + p.fp, 0) / best.length : 0;
  }
  return {
    season,
    perGame: { C: season.C / regularGames, LW: season.LW / regularGames, RW: season.RW / regularGames, D: season.D / regularGames },
    G: season.G,
  };
}

/** A player's replacement: the lowest of his eligible positions (where his marginal gain is largest). */
export function playerReplacement(rep: Replacement, g: Group, pos: readonly SlapPos[]): number {
  if (g === "G") return rep.G;
  const sk = pos.filter((p): p is Exclude<SlapPos, "G"> => p !== "G");
  const list = sk.length ? sk : g === "D" ? (["D"] as const) : (["C", "LW", "RW"] as const);
  return Math.min(...list.map((p) => rep.perGame[p]));
}

export interface LambdaResult {
  /** League-wide Lagrangian: the smallest λ at which the points-optimal 640 starters + 96 reserves fit under teams × cap. */
  aggregate: number;
  /** Cap used by the points-optimal counting players at λ = 0, M$ (league total). */
  capUsedAt0: number;
  budget: number;
  /**
   * Snake allocation (no trades): each team's own shadow price; mean over
   * teams and replications (sd across replications), median team, teams over
   * the cap per replication, the first (unjittered) replication's teams.
   */
  snake: {
    mean: number;
    sd: number;
    reps: number;
    median: number;
    over: number;
    perTeam: number[];
    teamCap: { min: number; median: number; max: number };
  };
}

/**
 * Cap shadow price in one season (league points per M$).
 *  - aggregate: bisection on λ so that the seat fill on fp − λ (cap − min)
 *    plus the next 96 as reserves costs at most teams × cap (0 when the
 *    points-optimal set already fits — trades can then move every surplus);
 *  - snake: the counting players (seated + reserves at λ = 0) dealt to 32
 *    teams in snake order by points (each team's seats, then 3 reserves);
 *    a team over its cap swaps starters for free agents at the fewest
 *    points lost per M$ saved until it fits; its λ is the last swap's rate
 *    (0 under the cap). The mean over teams is a generic team's λ before
 *    trades.
 */
export function capLambda(prof: SlapshotProfile, players: readonly SeatPlayer[], capM: number, minM: number): LambdaResult {
  const teams = prof.league.teams;
  const R = prof.roster.reserve * teams;
  const budget = teams * capM;
  const usedAt = (lam: number) => {
    const v = (p: SeatPlayer) => p.fp - lam * Math.max(0, p.cap - minM);
    const { seated, unseated } = seatFill(prof, players, v);
    const reserves = [...unseated].sort((a, b) => v(b) - v(a)).slice(0, R);
    let cap = 0;
    for (const p of players) if (seated.has(p.id)) cap += p.cap;
    for (const p of reserves) cap += p.cap;
    return { cap, seated, reserves };
  };
  const at0 = usedAt(0);
  let aggregate = 0;
  if (at0.cap > budget) {
    let lo = 0;
    let hi = 1;
    while (usedAt(hi).cap > budget && hi < 1e4) hi *= 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (usedAt(mid).cap > budget) lo = mid;
      else hi = mid;
    }
    aggregate = hi;
  }

  // ---- snake allocation of the λ = 0 counting players, replicated over
  // draft orders jittered by the draft's noise (the first one unjittered)
  const counting = players.filter((p) => at0.seated.has(p.id) || at0.reserves.includes(p));
  const fa = players
    .filter((p) => !counting.includes(p))
    .sort((a, b) => b.fp - a.fp || a.id.localeCompare(b.id))
    .slice(0, 400);
  const rng = rngFor(`|slap-lambda|${capM}`);
  const reps: SnakeLambda[] = [];
  for (let k = 0; k < SNAKE_REPS; k++) {
    const jit = new Map(counting.map((p) => [p.id, k === 0 ? 1 : Math.exp(SNAKE_JITTER * rng.n())]));
    const order = [...counting].sort((a, b) => b.fp * jit.get(b.id)! - a.fp * jit.get(a.id)! || a.id.localeCompare(b.id));
    reps.push(snakeLambda(prof, order, fa, capM));
  }
  const means = reps.map((r) => r.mean);
  const m = means.reduce((s, x) => s + x, 0) / means.length;
  const sd = Math.sqrt(means.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, means.length - 1));
  const med = [...reps.flatMap((r) => r.perTeam)].sort((a, b) => a - b);
  const capsAll = reps.flatMap((r) => r.caps).sort((a, b) => a - b);
  return {
    aggregate,
    capUsedAt0: at0.cap,
    budget,
    snake: {
      mean: m,
      sd,
      reps: reps.length,
      median: med[med.length >> 1]!,
      over: reps.reduce((s, r) => s + r.caps.filter((c) => c > capM).length, 0) / reps.length,
      perTeam: reps[0]!.perTeam.map((x) => Math.round(x * 100) / 100),
      teamCap: { min: capsAll[0]!, median: capsAll[capsAll.length >> 1]!, max: capsAll[capsAll.length - 1]! },
    },
  };
}

/** Snake replications of the λ estimator, and the log-sd of the draft-order noise. */
const SNAKE_REPS = 12;
const SNAKE_JITTER = 0.15;

interface SnakeLambda {
  mean: number;
  perTeam: number[];
  caps: number[];
}

/** One snake allocation (players best first) and each team's own cap knapsack. */
function snakeLambda(prof: SlapshotProfile, order: readonly SeatPlayer[], fa: readonly SeatPlayer[], capM: number): SnakeLambda {
  const teams = prof.league.teams;
  const perTeamSeats = prof.roster.active;
  const rosters = Array.from({ length: teams }, () => ({
    need: { ...perTeamSeats } as Record<SlapPos, number>,
    res: prof.roster.reserve,
    pl: [] as Array<{ p: SeatPlayer; seat: SlapPos | "R" }>,
  }));
  const taken = new Set<string>();
  const rounds = SLAP_POS.reduce((s, k) => s + perTeamSeats[k], 0) + prof.roster.reserve;
  for (let round = 0; round < rounds; round++) {
    for (let i = 0; i < teams; i++) {
      const tm = rosters[round % 2 ? teams - 1 - i : i]!;
      const full = SLAP_POS.every((k) => tm.need[k] === 0);
      const p = order.find((x) => !taken.has(x.id) && (x.pos.some((e) => tm.need[e] > 0) || (full && tm.res > 0)));
      if (!p) continue;
      taken.add(p.id);
      const e = p.pos.find((k) => tm.need[k] > 0);
      if (e) tm.need[e]--;
      else tm.res--;
      tm.pl.push({ p, seat: e ?? "R" });
    }
  }
  const usedFa = new Set<string>();
  const perTeam: number[] = [];
  const caps: number[] = [];
  for (const tm of rosters) {
    let cap = tm.pl.reduce((s, x) => s + x.p.cap, 0);
    caps.push(cap);
    let last = 0;
    const swapped = new Set<string>();
    while (cap > capM) {
      let best: { i: number; q: SeatPlayer; r: number; save: number } | null = null;
      tm.pl.forEach((x, i) => {
        if (swapped.has(x.p.id)) return;
        for (const q of fa) {
          if (usedFa.has(q.id)) continue;
          if (x.seat !== "R" && !q.pos.includes(x.seat)) continue;
          const save = x.p.cap - q.cap;
          if (save <= 0.25) continue;
          const r = Math.max(0, x.p.fp - q.fp) / save;
          if (!best || r < best.r) best = { i, q, r, save };
        }
      });
      if (!best) break;
      const b = best as { i: number; q: SeatPlayer; r: number; save: number };
      swapped.add(tm.pl[b.i]!.p.id);
      usedFa.add(b.q.id);
      cap -= b.save;
      last = b.r;
    }
    perTeam.push(last);
  }
  return { mean: perTeam.reduce((s, x) => s + x, 0) / teams, perTeam, caps };
}

// ---------------------------------------------------------------- expected level path

/**
 * Expected per-game level per season t on the NHL path (league-1 realized
 * scale): year 0, the young skater's growth path, then the λ-scaled curve.
 * Prospects: the prime scaled by the curve from their expected arrival.
 */
export function expectedTheta(level: LevelFn, p: DynastyParams, r: Routed, T: number): number[] {
  const sim = r.sim;
  const out = new Array<number>(T).fill(0);
  if (!sim) return out;
  if (sim.path === "nhl") {
    const rel = sim.gRel ?? null;
    const H = rel ? rel.length : 0;
    const base = sim.theta0 ?? 0;
    for (let t = 0; t < T; t++) {
      if (t < H) out[t] = base * rel![t]!;
      else {
        const anchorT = H ? H - 1 : 0;
        const anchor = H ? base * rel![anchorT]! : base;
        out[t] = (anchor * level(r.g, sim.age0 + t)) / level(r.g, sim.age0 + anchorT);
      }
    }
    return out;
  }
  const pm = sim.pm!;
  const y0 = p.firstSeasonYear;
  for (let t = 0; t < T; t++) {
    if (y0 + t < pm.eta) continue;
    out[t] = (pm.pi.mu * level(r.g, sim.age0 + t)) / level(r.g, p.prospect.primeAge);
  }
  return out;
}

// ---------------------------------------------------------------- per-player league data

export interface SlapPlayerData {
  /** Slapshot / league-1 per-game ratio of his projection (null: group default). */
  k: number | null;
  pos: SlapPos[];
  known: KnownContract;
}

export interface SlapPrepared {
  capSeries: CapSeries;
  lambda: number[];
  lambdaDiag: LambdaResult;
  repl: Replacement;
  kDefault: Record<Group, number>;
  contracts: Map<string, ContractPath>;
  /** k × fantasy share per player (the sim's lg.k), for the eFP conversion. */
  kEff: Map<string, number>;
  pos: Map<string, SlapPos[]>;
  /** Expected 2026-27 season points (league scoring) of NHL-path players. */
  seasonFp0: Map<string, number>;
  regularGames: number;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[(s.length - 1) >> 1]! : 1;
};

/**
 * Roster-spot rent per season: every held player fills one of the league's
 * teams × 40 spots, so holding him costs what the marginal rostered asset
 * (the teams × max-th balanced value) would return — its value as a
 * perpetuity at the balanced δ.
 */
export function rosterSpotCost(dvBalanced: readonly number[], rank: number, delta: number): number {
  const s = [...dvBalanced].sort((a, b) => b - a);
  const x = s[Math.min(s.length, rank) - 1] ?? 0;
  return Math.max(0, x) * (1 - delta);
}

/**
 * λ per season from season pools (expected league points and cap hits of
 * season t): capLambda's method value for t < pools.length, then held per
 * share of the cap (λ_t = λ_last · C_last / C_t).
 */
export function lambdaBySeason(
  prof: SlapshotProfile,
  cs: CapSeries,
  pools: ReadonlyArray<readonly SeatPlayer[]>,
): { lambda: number[]; diag: LambdaResult[] } {
  const diag = pools.map((pool, t) => capLambda(prof, pool, cs.league[t]!, cs.min[t]!));
  const pick = (d: LambdaResult) =>
    prof.lambda.method === "fixed" ? prof.lambda.fixed : prof.lambda.method === "aggregate" ? d.aggregate : d.snake.mean;
  // later pools are diagnostics only (projected contracts, no future draft classes)
  const known = diag.slice(0, Math.max(1, Math.min(diag.length, prof.lambda.solvedSeasons ?? diag.length))).map(pick);
  const last = known.length - 1;
  const lambda = cs.league.map((c, t) => (t <= last ? known[t]! : (known[last]! * cs.league[last]!) / c));
  return { lambda, diag };
}

/** λ by season: the λ-method value in 2026-27, held constant per share of the cap afterwards (λ_t = λ_0 · C_0 / C_t). */
export function lambdaPath(lam0: number, cs: CapSeries): number[] {
  return cs.league.map((c) => (lam0 * cs.league[0]!) / c);
}

/**
 * Everything the simulation needs from the league: per-player scoring ratio,
 * replacement, contract path and cap charge (sets r.sim.lg), plus the
 * league diagnostics (λ, replacement levels).
 */
export function prepareSlapshot(
  prof: SlapshotProfile,
  p: DynastyParams,
  level: LevelFn,
  routed: readonly Routed[],
  data: ReadonlyMap<string, SlapPlayerData>,
  model: SalaryModel,
  opts: {
    /** λ per season (league points per M$) instead of the 2026-27 value held per share of the cap. */
    lambda?: readonly number[];
    /** Gate every season (roster spot) instead of a free minors stash. */
    rosterGate?: boolean;
  } = {},
): SlapPrepared {
  const T = p.T;
  const y0 = p.firstSeasonYear;
  const SG = p.games.seasonGames;
  const phi = prof.season.fantasyShare;
  const regularGames = p.games.regShareMean * SG;
  const cs = capSeries(prof, y0, T);
  // group default k: median over NHL-path regulars (prospects, unmatched)
  const kd: Record<Group, number[]> = { F: [], D: [], G: [] };
  for (const r of routed) {
    const k = data.get(r.input.id)?.k;
    if (k != null && r.path === "nhl" && (r.sim?.share0 ?? 0) >= 0.4) kd[r.g].push(k);
  }
  const kDefault: Record<Group, number> = { F: median(kd.F), D: median(kd.D), G: median(kd.G) };
  const kEff = new Map<string, number>();
  const pos = new Map<string, SlapPos[]>();
  const theta = new Map<string, number[]>();
  const contracts = new Map<string, ContractPath>();
  for (const r of routed) {
    const d = data.get(r.input.id);
    const k = (d?.k ?? kDefault[r.g]) * phi;
    kEff.set(r.input.id, k);
    const ps = d?.pos.length ? d.pos : r.g === "G" ? (["G"] as SlapPos[]) : r.g === "D" ? (["D"] as SlapPos[]) : fallbackPos(r.input.e);
    pos.set(r.input.id, ps);
    const th = expectedTheta(level, p, r, T);
    theta.set(r.input.id, th);
    const share = r.sim?.path === "nhl" ? (r.sim.share0 ?? 0.5) : r.g === "G" ? 0.5 : p.games.regShareMean;
    const arrival = r.sim?.path === "prospect" ? r.sim.pm!.eta : y0;
    const known = d?.known ?? { seasons: {}, exp: null, elc: false, source: "none" as const };
    contracts.set(
      r.input.id,
      contractPath(prof, model, y0, T, {
        g: r.g,
        age0: r.age0,
        known,
        theta: th,
        share: r.g === "G" ? Math.max(0.2, share) : Math.max(0.3, share),
        arrival,
        // nothing signed from 2026-27: a prospect, or a young player short of an NHL career, signs an ELC
        rookie: !Object.keys(known.seasons).length && (r.path === "prospect" || (r.age0 < 23 && r.gp0 < 100)),
      }),
    );
  }
  // season-0 seat pool: NHL-path players, expected fantasy points and cap hit
  const seasonFp0 = new Map<string, number>();
  const seat: SeatPlayer[] = [];
  for (const r of routed) {
    if (r.path !== "nhl" || !r.sim || r.sim.theta0 == null) continue;
    const id = r.input.id;
    const fp = kEff.get(id)! * r.sim.theta0 * (r.sim.share0 ?? 0) * SG;
    seasonFp0.set(id, fp);
    seat.push({ id, pos: pos.get(id)!, fp, cap: contracts.get(id)!.cap[0]! });
  }
  const repl = replacementLevels(prof, seat, regularGames);
  // cap shadow price in 2026-27 on points above replacement
  const lambdaDiag = capLambda(prof, seat, cs.league[0]!, cs.min[0]!);
  const lam0 =
    prof.lambda.method === "fixed" ? prof.lambda.fixed : prof.lambda.method === "aggregate" ? lambdaDiag.aggregate : lambdaDiag.snake.mean;
  const lambda = opts.lambda ? [...opts.lambda] : lambdaPath(lam0, cs);
  for (const r of routed) {
    if (!r.sim) continue;
    const id = r.input.id;
    const c = contracts.get(id)!;
    const lg: SimLeague = {
      k: kEff.get(id)!,
      r: playerReplacement(repl, r.g, pos.get(id)!),
      rG: repl.G,
      capCost: c.cap.map((x, t) => lambda[t]! * Math.max(0, x - cs.min[t]!)),
      ...(opts.rosterGate ? { noEligibility: true } : {}),
    };
    r.sim.lg = lg;
  }
  return { capSeries: cs, lambda, lambdaDiag, repl, kDefault, contracts, kEff, pos, seasonFp0, regularGames };
}

function fallbackPos(e: string): SlapPos[] {
  const t = e.split(",").map((x) => x.trim());
  const out: SlapPos[] = [];
  if (t.includes("C")) out.push("C");
  if (t.includes("W") || t.includes("LW")) out.push("LW");
  if (t.includes("W") || t.includes("RW")) out.push("RW");
  if (t.includes("D")) out.push("D");
  return out.length ? out : ["C", "LW", "RW"];
}

// ---------------------------------------------------------------- output

export interface SlapContractOut {
  /** Cap hit per season (M$, 2 dp), 2026-27 first. */
  cap: number[];
  /** Seasons of the list that are signed (the rest projected). */
  signed: number;
  /** First season without a signed contract (start year), null = signed through 2037-38. */
  expiry: number | null;
  status: "UFA" | "RFA" | null;
  /** Projected AAV of the next contract, M$. */
  nextAav: number | null;
  elc: boolean;
  /** 2026-27 cap hit / league cap. */
  capShare: number;
  /** Cap charge per season, league points (λ_t × (cap_t − min_t)). */
  capFP: number[];
  source: KnownContract["source"];
}

export interface SlapshotRecord
  extends Pick<
    DynastyRecord,
    "n" | "g" | "age" | "nhlId" | "path" | "phase" | "effAge" | "gp" | "draft" | "dv" | "rank" | "band" | "eG" | "p50G" | "trend" | "growth" | "pNhl" | "eta" | "flags"
  > {
  /** Slapshot positions. */
  pos: SlapPos[];
  /** Expected league points per season (fantasy season, Slapshot scoring), integers. */
  eFP: number[];
  /** Expected 2026-27 season points (league scoring), NHL path. */
  fp0: number | null;
  contract: SlapContractOut;
  /** Crowd signals (information; market layer on prospects / goalies only). */
  market: DynastyRecord["market"];
  /** French explanation (one sentence). */
  explanation: string;
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function slapshotRecord(rec: DynastyRecord, prep: SlapPrepared, id: string, explain: (r: SlapshotRecord) => string): SlapshotRecord {
  const c = prep.contracts.get(id)!;
  const k = prep.kEff.get(id) ?? 1;
  const cs = prep.capSeries;
  const out: SlapshotRecord = {
    n: rec.n,
    g: rec.g,
    pos: prep.pos.get(id) ?? [],
    age: rec.age,
    ...(rec.nhlId ? { nhlId: rec.nhlId } : {}),
    path: rec.path,
    phase: rec.phase,
    effAge: rec.effAge,
    gp: rec.gp,
    ...(rec.draft ? { draft: rec.draft } : {}),
    dv: rec.dv,
    rank: rec.rank,
    band: rec.band,
    eG: rec.eG,
    p50G: rec.p50G,
    eFP: rec.eFP.map((x) => Math.round(x * k)),
    fp0: prep.seasonFp0.has(id) ? Math.round(prep.seasonFp0.get(id)!) : null,
    trend: rec.trend ?? null,
    ...(rec.growth ? { growth: rec.growth } : {}),
    pNhl: rec.pNhl,
    eta: rec.eta,
    contract: {
      cap: c.cap.map(r2),
      signed: c.known,
      expiry: c.expiry,
      status: c.status,
      nextAav: c.nextAav == null ? null : r2(c.nextAav),
      elc: c.elc,
      capShare: Math.round((c.cap[0]! / cs.league[0]!) * 1000) / 1000,
      capFP: c.cap.map((x, t) => r1(prep.lambda[t]! * Math.max(0, x - cs.min[t]!))),
      source: c.source,
    },
    market: rec.market,
    ...(rec.flags ? { flags: rec.flags } : {}),
    explanation: "",
  };
  out.explanation = explain(out);
  return out;
}

// ---------------------------------------------------------------- French sentence

const NBSP = " ";
const seasonLabel = (y: number) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`;
const money = (m: number) => `${m.toFixed(m >= 10 ? 1 : 2).replace(".", ",")}${NBSP}M$`;
const POS_FR: Record<Group, string> = { F: "Attaquant", D: "Défenseur", G: "Gardien" };
const PHASE_CLAUSE: Record<DynastyRecord["phase"], string> = {
  prospect: "espoir",
  rising: "en progression",
  entering_prime: "qui entre dans son prime",
  prime: "dans son prime",
  plateau: "au plateau",
  declining: "en déclin",
  late_career: "en fin de carrière",
};

/** One sentence (≤ 240 characters): who and phase, contract, time profile, upside. */
export function explainSlapshotFr(r: SlapshotRecord, y0 = 2026, maxLen = 240): string {
  const age = Math.floor(r.age);
  const clauses: string[] = [];
  if (r.phase === "prospect" && r.path !== "nhl") {
    const draft = r.draft ? ` (${r.draft.pick}${r.draft.pick === 1 ? "er" : "e"} choix LNH ${r.draft.year})` : "";
    const eta = r.eta != null ? `, arrivée ${seasonLabel(r.eta)}` : "";
    clauses.push(`${r.g === "G" ? "Gardien espoir" : "Espoir"} de ${age} ans${draft}${NBSP}: ${Math.round(r.pNhl * 100)}${NBSP}% de chances de s’établir${eta}`);
  } else {
    const t = r.trend != null && Math.abs(r.trend) >= 0.01 ? ` (${r.trend > 0 ? "+" : "−"}${Math.round(Math.abs(r.trend) * 100)}${NBSP}%/an)` : "";
    clauses.push(`${POS_FR[r.g]} de ${age} ans ${PHASE_CLAUSE[r.phase]}${t}`);
  }
  const c = r.contract;
  if (c.signed > 0) {
    const until = seasonLabel(y0 + c.signed - 1);
    const kind = c.elc ? "contrat d’entrée" : "contrat";
    // French status: JAS (joueur autonome sans compensation) / JAC (avec compensation).
    const st = c.status === "RFA" ? "JAC" : "JAS";
    const next = c.expiry != null && c.nextAav != null ? `, puis ~${money(c.nextAav)} projetés (${st})` : "";
    // a signed extension that starts later (Celebrini: ELC in 2026-27, then 18.8 M$)
    const ch = c.cap.slice(1, c.signed).findIndex((x) => Math.abs(x - c.cap[0]!) > 0.05 * Math.max(1, c.cap[0]!));
    const now =
      ch < 0
        ? `${kind} à ${money(c.cap[0]!)} jusqu’en ${until}`
        : `${kind} à ${money(c.cap[0]!)}${ch === 0 ? ` en ${seasonLabel(y0)}` : ` jusqu’en ${seasonLabel(y0 + ch)}`}, puis ${money(c.cap[ch + 1]!)} signés jusqu’en ${until}`;
    clauses.push(`${now}${next}`);
  } else if (c.elc && r.path === "nhl") {
    clauses.push(`sans contrat LNH${NBSP}: contrat d’entrée supposé (${money(c.cap[0]!)})`);
  } else if (c.nextAav != null && r.path === "nhl") {
    clauses.push(`sans contrat pour ${seasonLabel(y0)}${NBSP}: ~${money(c.nextAav)} projetés`);
  }
  // The cap charge of each of the next two seasons, not their average: λ
  // differs several-fold between them (McDavid 15.9 then 2.5 points).
  const c0 = c.capFP[0] ?? 0;
  const c1 = c.capFP[1] ?? 0;
  const charge = c0 + c1;
  const gain = r.eG.slice(0, 2).reduce((s, x) => s + x, 0);
  if (charge >= 5 && charge >= 0.1 * (gain + charge)) {
    const [a, b] = [Math.round(c0), Math.round(c1)];
    clauses.push(
      a === b
        ? `le plafond lui coûte ~${a} pts en ${seasonLabel(y0)} comme en ${seasonLabel(y0 + 1)}`
        : `le plafond lui coûte ~${a} pts en ${seasonLabel(y0)}, ~${b} en ${seasonLabel(y0 + 1)}`,
    );
  }
  let tot = 0;
  let near = 0;
  r.eG.forEach((x, t) => {
    const w = Math.pow(0.75, t) * x;
    tot += w;
    if (t <= 1) near += w;
  });
  const ns = tot > 0 ? near / tot : 0;
  if (r.dv.balanced >= 1) {
    if (ns >= 0.6) clauses.push(`${Math.round(ns * 100)}${NBSP}% de la valeur d’ici ${seasonLabel(y0 + 1)}`);
    else if (ns <= 0.3) clauses.push(`valeur surtout après ${seasonLabel(y0 + 1)}`);
  }
  const [, p50, p90] = r.band.balanced;
  if (p90 / Math.max(p50, 10) > 3 && p90 >= 30) clauses.push(`gros plafond (P90 ${Math.round(p90)} vs médiane ${Math.round(p50)})`);
  let s = clauses[0]!;
  for (const cl of clauses.slice(1)) {
    const next = `${s}${NBSP}; ${cl}`;
    if (next.length > maxLen) break;
    s = next;
  }
  return s;
}

/** DV per mode from eG (exact, the engine's weights). */
export function modesFrom(eG: readonly number[], modes: Record<Mode, { delta: number; w0: number; w1?: number }>): Record<Mode, number> {
  const out = {} as Record<Mode, number>;
  for (const m of MODES) {
    const w = modes[m];
    out[m] = eG.reduce((s, x, t) => s + (t === 0 ? w.w0 : t === 1 ? (w.w1 ?? 1) : 1) * Math.pow(w.delta, t) * x, 0);
  }
  return out;
}
