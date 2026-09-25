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
import { clamp, rngFor } from "./rng";
import type { Replacement } from "./scale";
import type { Group } from "./types";

export interface SimPlayer {
  id: string;
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
  /** Trajectory shift of the effective age (−1, 0, +1). */
  trajShift?: number;
  /** Share of the current regular season still to play. */
  remainingShare?: number;
  /** Share of season 0 he is expected to play given his status now (injury, suspension). */
  avail0?: number;
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
}

const PRE = 2; // level table offset: lv[k] = c̃(age0 + k − PRE)

export function simulatePlayer(pl: SimPlayer, ctx: SimContext): SimResult {
  const { p, level, ret, repl, N } = ctx;
  const T = p.T;
  const Y0 = p.firstSeasonYear;
  const g = pl.g;
  const R = g === "G" ? 0 : repl[g];
  const rng = rngFor(pl.id + ctx.seedKey);
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
          const pR = ret.pRegularNext(gs, ageT, ret.levelPct(gs, thPrev), Math.max(Kp.shareFloor, share));
          surv *= 1 - (1 - pR) * ret.pAbsentIfNotRegular(gs, ageT);
        } else if (thetaGate !== null && g === "G" && ageT >= gg.retireIfOutAge) {
          const ws = Math.min(1, share);
          surv *= ret.goalieRoleNext(ageT, ws, (thPrev - gg.svLeague - gg.svWorkload * ws) / gg.svFpPerPt).pP;
        }
      }
      if (!live || Y0 + t + j < arrival) continue;
      const th = thetaGate !== null ? thetaGate * fwd : (pi * lv[t + j + PRE]!) / lvl25;
      thPrev = th;
      idx += kdW[j]! * surv * Math.max(0, seasonValue(th, SG * sh));
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

  const seasonValue = (th: number, games: number) =>
    (g === "G" ? th * games - repl.Gseason : (th - R) * games) +
    (g === "F" ? 0.5 * Math.max(0, th - repl.offRef) * games : 0);

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
        arrival = Math.max(Y0, pm.eta + jit);
        arrivals.push(arrival);
        zPrime = rng.n();
        pi = Math.max(primeFloor, pm.pi.mu + pm.pi.sd * zPrime);
      }
    } else madeCount++;

    for (let t = 0; t < T; t++) {
      const season = Y0 + t;
      const age = pl.age0 + t;
      // ---- eligibility at the cutdown before season t (t = 0: the Fantrax flag)
      const eligible = t === 0 ? pl.eligNow : isEligible(p, g, cutAges[t]!, careerGp);
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
            const pct = ret.levelPct(gs, lastFpg ?? theta);
            const pR = ret.pRegularNext(gs, age - 1, pct, share);
            if (rng.u() < pR) share = Math.min(1, (G.regular[0] + G.regular[1] * Math.sqrt(rng.u())) * durPow[t]!);
            else if (rng.u() < ret.pAbsentIfNotRegular(gs, age - 1)) {
              share = 0;
              if (age - 1 >= G.retireIfOutAge) retired = true;
            } else share = G.partial[0] + G.partial[1] * rng.u();
          }
        }
        thetaT = theta;
        if (!retired && share > 0) {
          playing = true;
          fpgReal = theta * Math.exp(se * rng.n() - (se * se) / 2);
        }
      }
      // season 0: the part still to play, less a current injury / suspension
      const seasonScale = t === 0 ? remaining * avail0 : 1;
      const games = playing ? SG * share : 0;
      // in-season: the owner benches or drops him when the level is below replacement
      const inSeason = playing ? Math.max(0, seasonValue(thetaT, games)) * seasonScale : 0;
      vorPre[t]![n] = alive ? inSeason : 0;
      fp[t]![n] = playing ? fpgReal * games * seasonScale : 0;
      if (playing) inNhl[t]++;
      gamesSum[t] += games * seasonScale;
      if (gamesPath) gamesPath[t]![n] = games * seasonScale;

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

