/**
 * Explicit multi-season path simulation for one player (§3.4–3.9).
 *
 * Each path draws a year-0 level (NHL path) or make/arrival/prime (prospect
 * path), then ages the persistent level θ season by season with the
 * λ-scaled curve and a persistent shock, redraws the role (regular / partial
 * / absent; goalie starter / tandem / backup / out) from the retention
 * logistics, and
 * runs a real keeper cutdown every September: career GP accumulates along
 * the path, eligibility flips at exactly 100 GP (55 for goalies) or at 25,
 * and a non-eligible player is kept only if his 4-season keep index beats
 * the keeper-slot cost K; once released he is worth 0 for good.
 *
 * Everything is on the realized FP scale. Pure and seeded (mulberry32).
 *
 * Conditional growth (2026-09-25, growth.ts): a young NHL skater's level
 * follows his own expected path (`gRel`, by age × production × pedigree)
 * for the first seasons, with the young-player shocks, then the curve; a
 * prospect's arrival season is the base of the same model (arrival level
 * drawn with the historical debut spread around a centre that makes the
 * mean path meet the prime's mean, comonotone with the prime draw). Keeper fixes
 * from the audit: the keep index is compared with a gate in keep-index
 * units (`Kgate`, the 160th keep index per simulated league) while the slot
 * cost charged per kept season stays K; goalies get no share floor in the
 * keep index (a backup is valued as a backup).
 *
 * Goalie roles (keeper audit 2026-09-25): the starter / tandem / present
 * logistics take the raw games-started share, the unit they were fitted in
 * (the prototype's share / 0.6 kept tandem goalies starting ~90% of the time);
 * a starter's next share follows his last one (persistence 0.225).
 *
 * Audit fixes (2026-09-25): games = seasonGames (84) × share, projections
 * being shares of 82 games; a durable player's above-mean share carries into
 * later regular / starter draws (mean-reverting), so season 1 does not drop
 * by construction; a current injury trims season 0 only (`avail0`, never the
 * role fed to the next season's logistic); and the keep index at a cutdown
 * uses the expected level for the coming season, not its (unknowable) shock.
 */
import { ageShift, type LevelFn } from "./aging";
import { cutdownAge, isEligible } from "./eligibility";
import type { GrowthModel } from "./growth";
import type { DynastyParams } from "./params";
import type { ProspectModel } from "./prospect";
import type { Retention } from "./retention";
import { normalCdf } from "../fantrax/draft";
import { clamp, normalQuantile, rngFor } from "./rng";
import type { Replacement } from "./scale";
import type { Group } from "./types";

/**
 * A league other than the Captains Dynasty League (league profile, e.g.
 * Slapshot): its own scoring, replacement and salary cap. The level θ stays
 * on league 1's realized scale (aging, growth, retention and goalie roles are
 * fitted there); only the season value converts it. Absent = league 1
 * (captain premium, league-1 replacement), bit for bit.
 */
export interface SimLeague {
  /** League fantasy points per league-1 realized point, × the share of NHL games inside the fantasy season. */
  k: number;
  /**
   * k of season t relative to season 0 (absent = 1 every season): the
   * league's scoring ages apart from league 1's (slapshot.ts kDriftPath;
   * nearly flat once Slapshot scores hits and blocks).
   */
  kDrift?: number[];
  /** Skater replacement per NHL game, league points (same fantasy-season share). */
  r: number;
  /** Goalie replacement per season slot, league points. */
  rG: number;
  /**
   * Cap charge per season (league points): λ_t × (cap hit_t − league minimum),
   * counted for the part of the season he sits on the active roster or the
   * reserve (skaters: share / regular share, capped at 1; goalies: all
   * season). The owner's options each season are play (value − charge) or
   * the minors (0 points, 0 cap), so the season gain is max(0, value − charge).
   */
  capCost: number[];
  /**
   * No minors-eligibility rule (any player may sit in the minors): every
   * season from 2027-28 is gated — the owner keeps him (paying the roster
   * spot, ctx.K) while his keep index beats ctx.Kgate, else drops him for good.
   */
  noEligibility?: boolean;
  /**
   * League-contract planning: per season t, the salaries (M$) whose season
   * gain to average over the paths — max(0, value − λ_t × (salary − min_t))
   * when he plays, 0 when he does not (minors, retired, not arrived) — on the
   * same career paths as the value (growth, prime, decline, retirement, role,
   * injuries). The simulation adds each path's gains to `sum` and its paths
   * to `n` (both sides of a blended player add up).
   */
  contract?: { levels: number[][]; lambda: number[]; min: number[]; sum?: number[][]; n?: number };
}

export interface SimPlayer {
  id: string;
  /** League profile season value (absent = league 1). */
  lg?: SimLeague;
  g: Group;
  /** Age on Oct 1 of the first season (fractional). */
  age0: number;
  birthDate: string | null;
  /** Career NHL GP now (goalies: appearances). */
  gp0: number;
  eligNow: boolean;
  path: "nhl" | "prospect";
  /** NHL path: realized year-0 level (FP/G; goalies per start). */
  theta0?: number;
  /** NHL path: projected share of a season (goalies: starts), before injuries. */
  share0?: number;
  sigma0?: number;
  elite?: boolean;
  /**
   * Conditional growth (young NHL skaters): expected level of seasons
   * 0 … H − 1 relative to year 0 (gRel[0] = 1); later seasons follow the
   * curve. Null / absent = the curve from year 0.
   */
  gRel?: number[] | null;
  /** Persistent shock sd during the growth window (default: sigma.persistent). */
  spYoung?: number;
  /** NHL draft pick (a prospect's growth after arrival); null = undrafted. */
  pick?: number | null;
  pm?: ProspectModel | null;
  /**
   * Prospect path of a blended route (segment.ts): season 0 is `share` of a
   * season at the projection's level (the NHL side's θ0 and σ0) on every
   * path, made or not (its draws come from a stream of their own, so the
   * make-it, arrival and later seasons are the same paths whatever the
   * share), and the first regular season comes no earlier than 2027-28.
   * Its games count toward the minors-eligibility clock like any other
   * (verifier 2026-09-28: leaving them out published « free through
   * 2027-28 » for players certain to pass 100 GP). The « under 40 games »
   * side plays E[GP | GP < 40] / 82; the build's guard side (index.ts
   * blendSides) E[GP | GP ≥ 40] / 82. With `games` (the split-season rule's
   * N(gp, sd), projection basis) each path draws its games from that normal
   * cut to [lo, hi], mapped so their mean stays `share` (`year0Cut`: the cut
   * at 0 alone would add games): a player 15 games short of 100 keeps his
   * eligibility on the paths where he plays fewer than 15, not on none or
   * all of them.
   */
  year0?: { theta: number; sigma: number; share: number; games?: Year0Games } | null;
  /**
   * NHL side of a blended route (segment.ts): season 0's games per path from
   * the split-season normal cut to [40, basis], mean kept at `share0` (the
   * guard side's own draw), instead of the role model, whose absent and
   * partial seasons (20-32% of paths at these shares) are not the « 40+
   * games » scenario the side stands for (verifier 2026-09-28: they kept a
   * free minors spot on those paths, Oliver Moore 0.496 eligible in 2027).
   */
  games0?: Year0Games | null;
  /** Trajectory shift of the effective age (−1, 0, +1). */
  trajShift?: number;
  /** Share of the current regular season still to play. */
  remainingShare?: number;
  /** Share of season 0 he is expected to play given his status now (injury, suspension). */
  avail0?: number;
}

/** Season-0 games of a blended side: N(mu, sd) (projection basis) cut to [lo, hi]. */
export interface Year0Games {
  mu: number;
  sd: number;
  lo: number;
  hi: number;
  basis: number;
}

/**
 * A blended side's season-0 games per path: draws of N(mu, sd) cut to [lo,
 * hi] (`quantile(fLo + u · (fHi − fLo))`), mapped affinely onto [lo, hi] so
 * their mean is `target` games: anchored at `lo` when the target sits below
 * the cut's own mean (the « under 40 » side: the cut at 0 would add games),
 * at `hi` when above (the « 40+ » side: the cut at the basis drops the
 * normal's impossible games past 82). Verifier 2026-09-28: scaling both by
 * target / cut mean pushed the « 40+ » draws past the basis, clamped there,
 * so that side fell ~2% short of E[GP | GP ≥ 40] and never played under 40k.
 */
export function year0Cut(y: Year0Games, target: number): { fLo: number; fHi: number; games: (z: number) => number } | null {
  if (!(y.sd > 0)) return null;
  const [a, b] = [(y.lo - y.mu) / y.sd, (y.hi - y.mu) / y.sd];
  const [fLo, fHi] = [normalCdf(a), normalCdf(b)];
  if (!(fHi - fLo > 1e-9)) return null;
  const pdf = (z: number) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
  const cutMean = clamp(y.mu + (y.sd * (pdf(a) - pdf(b))) / (fHi - fLo), y.lo, y.hi);
  const t = clamp(target, y.lo, y.hi);
  const k =
    t <= cutMean ? (cutMean > y.lo ? (t - y.lo) / (cutMean - y.lo) : 0) : y.hi > cutMean ? (y.hi - t) / (y.hi - cutMean) : 0;
  const games = (z: number) => {
    const x = clamp(y.mu + y.sd * z, y.lo, y.hi);
    return clamp(t <= cutMean ? y.lo + (x - y.lo) * k : y.hi - (y.hi - x) * k, 0, y.basis);
  };
  return { fLo, fHi, games };
}

export interface SimContext {
  p: DynastyParams;
  level: LevelFn;
  ret: Retention;
  repl: Replacement;
  /** Keeper-slot cost charged per kept non-eligible season. */
  K: number;
  /** Keep-index threshold at a cutdown (default K). */
  Kgate?: number;
  /** Conditional growth of skaters after a prospect's arrival (absent = the curve). */
  growth?: GrowthModel | null;
  /** Record the keep index at the 2027 cutdown on every non-eligible path (K calibration). */
  recordKi?: boolean;
  /** Record NHL games per path and season (backtest fixtures: FP/G and survival per path). */
  recordGames?: boolean;
  N: number;
  keepGate: boolean;
  /** Seed key suffix: the RNG is keyed on player id + this. */
  seedKey: string;
  /** Test mode: σ0 = 0 and the year-0 share fixed at the projection. */
  fixedYear0?: boolean;
}

export interface SimResult {
  N: number;
  T: number;
  /** G_t per path (after the keeper cost). */
  gain: Float64Array[];
  /** Realized FP per path. */
  fp: Float64Array[];
  /** In-season value before K: max(0, VOR + CAP), 0 after release. */
  vorPre: Float64Array[];
  eligAt: number[];
  keptAt: number[];
  gateAt: number[];
  inNhl: number[];
  /** Mean NHL games per season (season 0: the part still played). */
  games: number[];
  pMade: number;
  arrivals: number[];
  /** Paths that lost eligibility first by age / by GP (eligible-now players). */
  lostBy: { age: number; gp: number };
  /**
   * Expected per-game level relative to season 0 (conditional growth, then
   * aging drift with the elite / trajectory shift; the persistent shocks are
   * mean-one). NHL path only; null for prospects.
   */
  lvlRel: number[] | null;
  /** Keep index at the 2027 cutdown per path (NaN when eligible); only with ctx.recordKi. */
  ki1: Float64Array | null;
  /** NHL games per season and path (season 0: the part still played); only with ctx.recordGames. */
  gamesPath: Float64Array[] | null;
  /**
   * A mixture's exact expectations (mixSimResults): the weighted means of
   * both full simulations. The per-path rows are a stratified draw of the
   * same mixture, for the bands, medians and keep indices only.
   */
  means?: { gain: number[]; fp: number[] };
}

const PRE = 2; // level table offset: lv[k] = c̃(age0 + k − PRE)

export function simulatePlayer(pl: SimPlayer, ctx: SimContext): SimResult {
  const { p, level, ret, repl, N } = ctx;
  const T = p.T;
  const Y0 = p.firstSeasonYear;
  const g = pl.g;
  const R = g === "G" ? 0 : repl[g];
  const rng = rngFor(pl.id + ctx.seedKey);
  // season 0 of a blended prospect side draws from its own stream: the main
  // stream (make-it, arrival, prime, later seasons) stays the one without it
  const rng0 = pl.year0 ? rngFor(`${pl.id}${ctx.seedKey}|y0`) : null;
  // a blended side's season-0 games per path: the split-season normal cut to its side of 40
  // (the prospect and guard sides: year0.games; the NHL side: games0)
  const y0g = pl.year0 ? (pl.year0.games ?? null) : pl.path === "nhl" && !ctx.fixedYear0 ? (pl.games0 ?? null) : null;
  const y0Cut = y0g ? year0Cut(y0g, (pl.year0 ? pl.year0.share : (pl.share0 ?? 0)) * y0g.basis) : null;
  const G = p.games;
  const gg = G.goalie;
  const spBase = p.sigma.persistent[g];
  const se = p.sigma.season[g];
  const Kp = p.K;
  const lookahead = Kp.lookahead;
  const kd = Kp.keepDelta;
  const remaining = clamp(pl.remainingShare ?? 1, 0, 1);
  const avail0 = clamp(pl.avail0 ?? 1, 0, 1);
  const SG = G.seasonGames;
  // Durability carry (skaters): the projected share above the mean regular
  // share. A goalie's next starter share follows his last share instead.
  const phi = G.durabilityCarry;
  const dur0 = pl.path === "nhl" && pl.share0 != null && g !== "G" ? Math.max(1, pl.share0 / G.regShareMean) : 1;
  const durPow = new Float64Array(T);
  for (let t = 0; t < T; t++) durPow[t] = 1 + (dur0 - 1) * Math.pow(phi, t);

  // ---- per-player tables (all ages are age0 + integer)
  const L = T + lookahead + PRE + 2;
  const lv = new Float64Array(L);
  for (let k = 0; k < L; k++) lv[k] = level(g, pl.age0 + k - PRE);
  const lvl25 = level(g, p.prospect.primeAge);
  const traj = pl.trajShift ?? 0;
  // drift[t] = c̃(a′_t) / c̃(a′_{t−1}) with the shift evaluated at season t
  // (aging.ts drift(); table lookups since every age is age0 + integer);
  // inside a young skater's growth window, his own expected path instead.
  const gRel = pl.path === "nhl" ? (pl.gRel ?? null) : null;
  const gH = gRel ? gRel.length : 0;
  const spYoung = pl.spYoung ?? spBase;
  const drift = new Float64Array(T + lookahead + 1);
  const cum = new Float64Array(T + lookahead + 1);
  cum[0] = 1;
  for (let t = 1; t <= T + lookahead; t++) {
    if (t < gH) drift[t] = gRel![t]! / gRel![t - 1]!;
    else {
      const s = ageShift(p, g, pl.age0 + t, !!pl.elite, traj);
      drift[t] = lv[t + s + PRE]! / lv[t - 1 + s + PRE]!;
    }
    cum[t] = cum[t - 1]! * drift[t]!;
  }
  const lvlRel = pl.path === "nhl" ? Array.from({ length: T }, (_, t) => cum[t]!) : null;
  // a prospect's growth after arrival (per path: it depends on his arrival age and level)
  const growthOn = !!ctx.growth && g !== "G" && pl.path === "prospect";
  // arrival centre per arrival season (it depends on the arrival age only; the path's z sets the level)
  const arrCentre = new Map<number, { theta: number; sd: number }>();
  const centreAt = (t: number) => {
    let c = arrCentre.get(t);
    if (!c) {
      c = ctx.growth!.arrivalCentre(g as "F" | "D", pl.age0 + t, pl.pick ?? null, pl.pm!.pi.mu);
      arrCentre.set(t, c);
    }
    return c;
  };
  let arrRel: number[] | null = null;
  let arrT = 0;
  let arrSp = spBase;
  /** Expected level step into season s (s ≥ 1) on the current path. */
  const stepAt = (s: number) => {
    if (arrRel) {
      const j = s - arrT;
      if (j >= 1 && j < arrRel.length) return arrRel[j]! / arrRel[j - 1]!;
    }
    return drift[s]!;
  };
  /** Persistent shock sd into season t (young-player sd inside a growth window). */
  const spAt = (t: number) => {
    if (arrRel) return t - arrT >= 1 && t - arrT < arrRel.length ? arrSp : spBase;
    return t < gH ? spYoung : spBase;
  };
  const cutAges = new Float64Array(T);
  for (let t = 1; t < T; t++) cutAges[t] = cutdownAge(p, pl.birthDate, pl.age0, t);
  const jitter = p.prospect.etaJitter;
  const primeFloor = p.prospect.primeFloor[g];

  const ki1 = ctx.recordKi ? new Float64Array(N).fill(Number.NaN) : null;
  const gamesPath = ctx.recordGames ? Array.from({ length: T }, () => new Float64Array(N)) : null;
  /**
   * Keep index at the cutdown before season t: the 4-season look-ahead
   * (δ_keep) of the value the owner can expect in September — the last
   * level × expected steps (no season shock), the coming role (skaters:
   * share floored at 0.5, 0.3 when out; goalies: their own share) — each
   * later season weighted by the odds he is still playing then (audit
   * 2026-09-25: retirement risk from the retention model, skaters absent at
   * 30+ / goalies out at 32+; before, a 41-year-old counted on 4 seasons).
   */
  const kdW = Array.from({ length: lookahead }, (_, j) => Math.pow(kd, j));
  const kdSum = kdW.reduce((a, b) => a + b, 0);
  const keepIndex = (t: number, live: boolean, arrival: number, thetaGate: number | null, pi: number, share: number) => {
    const sh =
      g === "G"
        ? Math.max(Kp.goalieShareFloor, share) * Kp.shareFactor
        : share > 0
          ? Math.max(Kp.shareFloor, share) * Kp.shareFactor
          : Kp.shareIfOut;
    let idx = 0;
    let fwd = 1;
    let surv = 1;
    let thPrev = thetaGate ?? 0;
    for (let j = 0; j < lookahead; j++) {
      if (j > 0) {
        fwd *= stepAt(t + j);
        // P(not retired going into season t + j), from his age and expected level a season earlier
        const ageT = pl.age0 + t + j - 1;
        if (thetaGate !== null && g !== "G" && ageT >= G.retireIfOutAge) {
          const gs = g as "F" | "D";
          const sh = Math.max(Kp.shareFloor, share);
          const pR = ret.pRegularNext(gs, ageT, ret.levelPct(gs, thPrev), sh);
          surv *= 1 - (1 - pR) * ret.pAbsentIfNotRegular(gs, ageT, sh);
        } else if (thetaGate !== null && g === "G" && ageT >= gg.retireIfOutAge) {
          const ws = Math.min(1, share);
          surv *= ret.goalieRoleNext(ageT, ws, (thPrev - gg.svLeague - gg.svWorkload * ws) / gg.svFpPerPt).pP;
        }
      }
      if (!live || Y0 + t + j < arrival) continue;
      const th = thetaGate !== null ? thetaGate * fwd : (pi * lv[t + j + PRE]!) / lvl25;
      thPrev = th;
      idx += kdW[j]! * surv * Math.max(0, lg ? seasonValue(th, SG * sh, t + j) - capCharge(t + j, sh) : seasonValue(th, SG * sh, t + j));
    }
    return idx / kdSum;
  };
  const gain = Array.from({ length: T }, () => new Float64Array(N));
  const fp = Array.from({ length: T }, () => new Float64Array(N));
  const vorPre = Array.from({ length: T }, () => new Float64Array(N));
  const eligAt = new Float64Array(T);
  const keptAt = new Float64Array(T);
  const gateAt = new Float64Array(T);
  const inNhl = new Float64Array(T);
  const gamesSum = new Float64Array(T);
  const arrivals: number[] = [];
  let madeCount = 0;
  let lostAge = 0;
  let lostGp = 0;

  const lg = pl.lg ?? null;
  const kAt = (t: number) => (lg ? lg.k * (lg.kDrift?.[Math.min(t, lg.kDrift.length - 1)] ?? 1) : 1);
  const seasonValue = lg
    ? (th: number, games: number, t: number) => (g === "G" ? kAt(t) * th * games - lg.rG : (kAt(t) * th - lg.r) * games)
    : (th: number, games: number, _t: number) =>
        (g === "G" ? th * games - repl.Gseason : (th - R) * games) +
        (g === "F" ? 0.5 * Math.max(0, th - repl.offRef) * games : 0);
  /** Cap charge of season t for a role share (league profile only). */
  const capCharge = (t: number, sh: number) =>
    lg ? (lg.capCost[t] ?? 0) * (g === "G" ? 1 : Math.min(1, sh / G.regShareMean)) : 0;
  const ct = lg?.contract ?? null;
  const ctSum = ct ? ct.levels.map((lv) => new Float64Array(lv.length)) : null;

  for (let n = 0; n < N; n++) {
    let alive = true;
    let retired = false;
    let theta: number | null = null;
    let share = 0;
    let careerGp = pl.gp0 || 0;
    let lastFpg: number | null = null;
    let made = pl.path === "nhl";
    let arrival = pl.path === "nhl" ? Y0 : Number.POSITIVE_INFINITY;
    let pi = 0;
    let zPrime = 0;
    let wasEligible = pl.eligNow;
    let lostCounted = false;
    arrRel = null;
    arrT = 0;
    if (pl.path === "prospect") {
      const pm = pl.pm!;
      made = rng.u() < pm.pMake;
      if (made) {
        madeCount++;
        const j = rng.u();
        let jit = jitter[jitter.length - 1]![0];
        let acc = 0;
        for (const [d, w] of jitter) {
          acc += w;
          if (j < acc) {
            jit = d;
            break;
          }
        }
        arrival = Math.max(pl.year0 ? Y0 + 1 : Y0, pm.eta + jit);
        arrivals.push(arrival);
        zPrime = rng.n();
        pi = Math.max(primeFloor, pm.pi.mu + pm.pi.sd * zPrime);
      }
    } else madeCount++;

    for (let t = 0; t < T; t++) {
      const season = Y0 + t;
      const age = pl.age0 + t;
      // ---- eligibility at the cutdown before season t (t = 0: the Fantrax flag)
      const eligible = pl.lg?.noEligibility ? false : t === 0 ? pl.eligNow : isEligible(p, g, cutAges[t]!, careerGp);
      if (eligible) eligAt[t]++;
      if (!lostCounted && wasEligible && !eligible) {
        lostCounted = true;
        if (cutAges[t]! >= p.eligibility.age) lostAge++;
        else lostGp++;
      }
      wasEligible = eligible;

      // ---- level and role this season
      let playing = false;
      let fpgReal = 0;
      let thetaT = 0;
      // level the owner can expect for season t at its cutdown (no season-t shock)
      let thetaGate = 0;
      if (made && !retired && season >= arrival) {
        if (theta === null) {
          if (pl.path === "nhl") {
            const s0 = ctx.fixedYear0 ? 0 : pl.sigma0!;
            theta = pl.theta0! * Math.exp(s0 * rng.n() - (s0 * s0) / 2);
            const share0 = pl.share0!;
            if (ctx.fixedYear0) share = share0;
            else if (y0Cut) share = y0Cut.games(normalQuantile(y0Cut.fLo + rng.u() * (y0Cut.fHi - y0Cut.fLo))) / y0g!.basis;
            else if (g === "G") share = clamp(share0 + p.sigma.goalieShare0 * rng.n(), 0, 1);
            else {
              const p0 = clamp((share0 - G.share0Floor) / (G.regShareMean - G.share0Floor), 0, 1);
              if (rng.u() < p0) {
                share = Math.min(1, (G.regular[0] + G.regular[1] * Math.sqrt(rng.u())) * Math.max(1, share0 / G.regShareMean));
              } else share = rng.u() < G.absentYear0 ? 0 : G.partial[0] + G.partial[1] * rng.u();
            }
            thetaGate = theta;
          } else {
            const ageArr = pl.age0 + t;
            if (growthOn && ageArr < ctx.growth!.maxBaseAge) {
              // the arrival season is the base of the conditional growth model: its level is
              // drawn around the centre with the historical debut spread, comonotone with
              // the prime draw (z), and the centre makes the mean path meet the prime's mean
              const c = centreAt(t);
              theta = c.theta * Math.exp(c.sd * zPrime - (c.sd * c.sd) / 2);
              const arr = { path: ctx.growth!.path(g as "F" | "D", ageArr, pl.pick ?? null, theta) };
              arrRel = [1, ...arr.path.m];
              arrT = t;
              arrSp = arr.path.persistent;
            } else theta = (pi * lv[t + PRE]!) / lvl25;
            thetaGate = theta;
            if (g === "G") share = gg.firstSeason[0] + gg.firstSeason[1] * rng.u();
            else
              share =
                rng.u() < G.prospectFirstSeason.pRegular
                  ? G.regular[0] + G.regular[1] * Math.sqrt(rng.u())
                  : G.prospectFirstSeason.fringeMax * rng.u();
          }
        } else {
          // expected step (conditional growth, then aging drift) + persistent shock
          const sp = spAt(t);
          thetaGate = theta * stepAt(t);
          theta = thetaGate * Math.exp(sp * rng.n() - (sp * sp) / 2);
          // role next season
          if (g === "G") {
            // role logistics on the raw games-started share (the unit they were fitted in)
            const ws = Math.min(1, share);
            const svRel = (theta - gg.svLeague - gg.svWorkload * ws) / gg.svFpPerPt;
            const role = ret.goalieRoleNext(age - 1, ws, svRel);
            const u = rng.u();
            const sn = gg.starterNext;
            if (u < role.pS) share = clamp(sn.a + sn.b * ws + sn.sd * rng.n(), sn.min, gg.maxShare);
            else if (u < role.pT) share = gg.tandem[0] + gg.tandem[1] * rng.u();
            else if (u < role.pP) share = gg.backup[0] + gg.backup[1] * rng.u();
            else {
              share = 0;
              if (age - 1 >= gg.retireIfOutAge) retired = true;
            }
          } else {
            const gs = g as "F" | "D";
            // after a season out of the NHL, the observed odds of coming back
            // (audit 2026-10-02: the logistics brought 73 % of 23-29-year-olds back, 16.5 % observed)
            const az = share === 0 ? ret.afterZero(age - 1) : null;
            const regular = () => Math.min(1, (G.regular[0] + G.regular[1] * Math.sqrt(rng.u())) * durPow[t]!);
            if (az) {
              const u = rng.u();
              if (u < az.pRegular) share = regular();
              else if (u < az.pAny) share = G.partial[0] + G.partial[1] * rng.u();
              else {
                share = 0;
                if (age - 1 >= G.retireIfOutAge) retired = true;
              }
            } else {
              const pct = ret.levelPct(gs, lastFpg ?? theta);
              const pR = ret.pRegularNext(gs, age - 1, pct, share);
              if (rng.u() < pR) share = regular();
              else if (rng.u() < ret.pAbsentIfNotRegular(gs, age - 1, share)) {
                share = 0;
                if (age - 1 >= G.retireIfOutAge) retired = true;
              } else share = G.partial[0] + G.partial[1] * rng.u();
            }
          }
        }
        thetaT = theta;
        if (!retired && share > 0) {
          playing = true;
          fpgReal = theta * Math.exp(se * rng.n() - (se * se) / 2);
        }
      }
      // the share his games come from this season (a blended prospect side's season 0: its own)
      let gShare = share;
      if (t === 0 && rng0 && pl.year0!.share > 0) {
        const y = pl.year0!;
        gShare = y.share;
        if (y0g && y0Cut) gShare = y0Cut.games(normalQuantile(y0Cut.fLo + rng0.u() * (y0Cut.fHi - y0Cut.fLo))) / y0g.basis;
        thetaT = y.theta * Math.exp(y.sigma * rng0.n() - (y.sigma * y.sigma) / 2);
        playing = gShare > 0;
        fpgReal = thetaT * Math.exp(se * rng0.n() - (se * se) / 2);
      }
      // season 0: the part still to play, less a current injury / suspension
      const seasonScale = t === 0 ? remaining * avail0 : 1;
      const games = playing ? SG * gShare : 0;
      // in-season: the owner benches or drops him when the level is below replacement
      // (league profile: play him — value less the cap charge — or stash him in the minors for 0)
      const inSeason = playing
        ? lg
          ? Math.max(0, seasonValue(thetaT, games, t) - capCharge(t, gShare)) * seasonScale
          : Math.max(0, seasonValue(thetaT, games, t)) * seasonScale
        : 0;
      vorPre[t]![n] = alive ? inSeason : 0;
      if (ct && ctSum && playing) {
        const v = seasonValue(thetaT, games, t) * seasonScale;
        const sc = g === "G" ? 1 : Math.min(1, gShare / G.regShareMean);
        const lv = ct.levels[t]!;
        const acc = ctSum[t]!;
        const lam = ct.lambda[t] ?? 0;
        const mn = ct.min[t] ?? 0;
        for (let j = 0; j < lv.length; j++) {
          const x = v - lam * Math.max(0, lv[j]! - mn) * sc;
          if (x > 0) acc[j] += x;
        }
      }
      fp[t]![n] = playing ? fpgReal * games * seasonScale : 0;
      if (playing) inNhl[t]++;
      gamesSum[t] += games * seasonScale;
      if (gamesPath) gamesPath[t]![n] = games * seasonScale;

      // A league contract and its extension are over: he is a free agent,
      // gone from the roster (no value, and no roster spot to pay for).
      if (alive && lg && (lg.capCost[t] ?? 0) >= 1e5) alive = false;
      // ---- keeper gate
      const gated = alive && t > 0 && !eligible && ctx.keepGate;
      const recKi = !!ki1 && t === 1 && !eligible;
      const idx = gated || recKi ? keepIndex(t, made && !retired, arrival, theta !== null ? thetaGate : null, pi, share) : 0;
      if (recKi) ki1![n] = idx;
      let gt = 0;
      if (alive) {
        if (!gated) gt = inSeason;
        else {
          gateAt[t]++;
          if (idx >= (ctx.Kgate ?? ctx.K)) {
            keptAt[t]++;
            gt = inSeason - ctx.K;
          } else {
            alive = false;
            gt = 0;
          }
        }
      }
      gain[t]![n] = gt;
      careerGp += (g === "G" ? games * gg.appearancesPerStart : games) * seasonScale;
      lastFpg = playing ? fpgReal : null;
    }
  }
  if (ct && ctSum) {
    if (!ct.sum) ct.sum = ct.levels.map((lv) => new Array<number>(lv.length).fill(0));
    ctSum.forEach((acc, t) => acc.forEach((x, j) => (ct.sum![t]![j]! += x)));
    ct.n = (ct.n ?? 0) + N;
  }
  const norm = (a: Float64Array) => Array.from(a, (x) => x / N);
  return {
    N,
    T,
    gain,
    fp,
    vorPre,
    eligAt: norm(eligAt),
    keptAt: norm(keptAt),
    gateAt: norm(gateAt),
    inNhl: norm(inNhl),
    games: norm(gamesSum),
    pMade: madeCount / N,
    arrivals,
    lostBy: { age: lostAge, gp: lostGp },
    lvlRel,
    ki1,
    gamesPath,
  };
}


/**
 * A mixture of two simulations of the same player on N paths each (the
 * blended NHL / prospect route, segment.ts). Its expectations (`means`:
 * per-season gains and FP) and every share already averaged over paths
 * (eligibility, keeper, NHL presence, games, P(made)) are the wA-weighted
 * means of BOTH full simulations: each side keeps its N paths (verifier
 * 2026-09-27: using only round(wA · N) paths of one side and the rest of the
 * other halved each side's sample and cost the seed-stability gate a rank,
 * long-term P95 12 → 13). The per-path rows (bands, medians, keep indices)
 * are a stratified draw of the mixture: the first round(w · N) paths of
 * `a`, then paths of `b` up to N. The level path (`lvlRel`) and the arrivals
 * follow the side that carries them. One weight for every season and every
 * output: values, eligibility and keeper odds always describe the same
 * mixture (verifier 2026-09-28: a later-season weight of its own published
 * one side's eligibility with the other's season 0).
 */
export function mixSimResults(a: SimResult, b: SimResult, wA: number): SimResult {
  const N = a.N;
  if (b.N !== N || b.T !== a.T) throw new Error("mixSimResults: simulations of different shapes");
  const w = Math.max(0, Math.min(1, wA));
  const kA = Math.round(w * N);
  const meanRow = (row: Float64Array) => {
    let s = 0;
    for (let n = 0; n < row.length; n++) s += row[n]!;
    return s / row.length;
  };
  const expect = (x: SimResult, key: "gain" | "fp") => x.means?.[key] ?? x[key].map(meanRow);
  const mixMean = (key: "gain" | "fp") => {
    const ea = expect(a, key);
    const eb = expect(b, key);
    return ea.map((v, t) => w * v + (1 - w) * eb[t]!);
  };
  const perPath = (x: Float64Array, y: Float64Array) => {
    const out = new Float64Array(N);
    out.set(x.subarray(0, kA), 0);
    out.set(y.subarray(kA, N), kA);
    return out;
  };
  const rows = (x: Float64Array[], y: Float64Array[]) => x.map((row, t) => perPath(row, y[t]!));
  const avg = (x: number[], y: number[]) => x.map((v, t) => w * v + (1 - w) * y[t]!);
  // arrivals are listed per arriving path: keep each side's share of them
  const take = (xs: number[], share: number) => xs.slice(0, Math.round(xs.length * share));
  return {
    N,
    T: a.T,
    gain: rows(a.gain, b.gain),
    fp: rows(a.fp, b.fp),
    vorPre: rows(a.vorPre, b.vorPre),
    eligAt: avg(a.eligAt, b.eligAt),
    keptAt: avg(a.keptAt, b.keptAt),
    gateAt: avg(a.gateAt, b.gateAt),
    inNhl: avg(a.inNhl, b.inNhl),
    games: avg(a.games, b.games),
    pMade: w * a.pMade + (1 - w) * b.pMade,
    arrivals: [...take(a.arrivals, w), ...take(b.arrivals, 1 - w)],
    lostBy: {
      age: w * a.lostBy.age + (1 - w) * b.lostBy.age,
      gp: w * a.lostBy.gp + (1 - w) * b.lostBy.gp,
    },
    lvlRel: a.lvlRel ?? b.lvlRel,
    ki1: a.ki1 && b.ki1 ? perPath(a.ki1, b.ki1) : (a.ki1 ?? b.ki1),
    gamesPath: a.gamesPath && b.gamesPath ? rows(a.gamesPath, b.gamesPath) : null,
    means: { gain: mixMean("gain"), fp: mixMean("fp") },
  };
}

/**
 * Season 0 of one simulation, seasons 1 … T − 1 of another, of the same
 * player and scenario (the blended route's guard, index.ts blendSides: the
 * NHL side's 2026-27, then the prospect prior's later seasons after the same
 * 2026-27 games). Eligibility, keeper shares, the 2027 keep index, P(made)
 * and the arrivals come from `later` (its paths played the same season-0
 * games, so its eligibility clock is the scenario's); season-0 rows, games
 * and NHL presence from `season0`. Path rows pair path n of each: the later
 * side's season 0 draws from a stream of its own (simulate.ts `year0`), so
 * its later seasons never depended on its own season-0 draws either.
 */
export function spliceSeason0(season0: SimResult, later: SimResult): SimResult {
  if (season0.N !== later.N || season0.T !== later.T) throw new Error("spliceSeason0: simulations of different shapes");
  const rows = (x: Float64Array[], y: Float64Array[]) => y.map((row, t) => (t === 0 ? x[0]! : row));
  const first = (x: number[], y: number[]) => y.map((v, t) => (t === 0 ? x[0]! : v));
  const meanRow = (row: Float64Array) => row.reduce((s, v) => s + v, 0) / row.length;
  const exp = (x: SimResult, key: "gain" | "fp") => x.means?.[key] ?? x[key].map(meanRow);
  return {
    ...later,
    gain: rows(season0.gain, later.gain),
    fp: rows(season0.fp, later.fp),
    vorPre: rows(season0.vorPre, later.vorPre),
    inNhl: first(season0.inNhl, later.inNhl),
    games: first(season0.games, later.games),
    gamesPath: season0.gamesPath && later.gamesPath ? rows(season0.gamesPath, later.gamesPath) : null,
    lvlRel: season0.lvlRel ?? later.lvlRel,
    means: {
      gain: first(exp(season0, "gain"), exp(later, "gain")),
      fp: first(exp(season0, "fp"), exp(later, "fp")),
    },
  };
}
