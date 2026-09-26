/**
 * Conditional growth of young skaters (params.growth), replacing the
 * population curve + pedigree pull for players whose base season was at
 * 18–23. Fitted on 2,653 NHL skater-seasons 2008-09 … 2024-25 (Captains
 * Dynasty scoring, era-adjusted; scratchpad/dynasty/growthmodel/fit.cjs):
 *
 *   ln G_k = ln[c̃(a + k) / c̃(a)] · (1 + γ · h(pct))   the population curve (λ-scaled); above-
 *                                                     median producers realize less of it,
 *                                                     h = max(0, (pct − 0.5) / 0.5)²
 *          + A(pos, age band, k)                       pooled excess over the curve
 *          + B(pos, production band, k)                regression to the mean by percentile
 *          + P(pos, ln pick, pct)                      pedigree × production (bilinear surface)
 *          + v_k(pos, production band) / 2             lognormal mean (path shocks are mean-one)
 *
 * G_k is the expected FP/G k seasons after the base season relative to the
 * base FP/G. The production cells are empirical-Bayes shrunk and monotone
 * (pool-adjacent-violators). Pedigree interacts with production (audit
 * 2026-09-25, scratchpad/dynasty/fix2/fit2.cjs): its effect is a surface
 * over 3 pedigree centres (top-10 / 11-32 / 33+ and undrafted, at their mean
 * ln pick) × 3 production centres (<p50 / p50-75 / p75+), centred within each
 * production centre and EB-shrunk (prior sd pooled over F and D): a top-10
 * pick producing at p50-75 outgrows a late pick at the same production by
 * ~10% (F) / ~8% (D), while among top producers pedigree barely matters. The
 * age × production cells have ~0 variance, so age stays additive. Linear
 * over the age-band centres and production-band centres, flat outside.
 *
 * NHL path: base = the 2025-26 FP/G blended with the projection
 * (w = GP / (GP + 36), no games threshold); year 0 = base × G_1 and seasons
 * 1–5 follow G_2 … G_6. The whole base regresses like an observed season:
 * for young players the projection tracks the last season's level (ln
 * ratio sd 0.10, below a season's own noise ~0.13), so it carries most of
 * that season's noise rather than being a shrunk expectation.
 * Prospects: the arrival level is drawn around a centre with the historical
 * spread of first NHL seasons (params.growth.arrival.sd, net of season
 * noise), comonotone with the prime draw; the centre is set so the expected
 * path meets the prime's mean at 25. (Solving θ · G(θ) = prime per path
 * inverted the forward regression and amplified the prime's spread ~2×.)
 */
import type { LevelFn } from "./aging";
import type { DynastyParams } from "./params";
import { clamp } from "./rng";
import type { SeasonLine } from "./types";

export type GrowthGroup = "F" | "D";

export interface GrowthPath {
  /** G_1 … G_H: expected FP/G relative to the base season. */
  m: number[];
  /** Production percentile of the base among same-age, same-position NHL seasons (0–1). */
  pct: number;
  /** Production band label (params.growth.prodBands). */
  prod: string;
  /** ln-scale pedigree term (β · centred ln pick). */
  ped: number;
  /** Year-0 sd of a young skater: the band's σ0 widened by its posterior sd. */
  sigma0: number;
  /** Persistent shock sd during the growth window. */
  persistent: number;
}

export interface GrowthModel {
  horizon: number;
  maxBaseAge: number;
  /** Growth path from a base season at `baseAge` with base FP/G `fpg`. */
  path(g: GrowthGroup, baseAge: number, pick: number | null, fpg: number): GrowthPath;
  /** Percentile of a base FP/G at `baseAge`. */
  pct(g: GrowthGroup, baseAge: number, fpg: number): number;
  /**
   * Prospect arrival: the centre θ_c of the arrival level (the base) and its
   * log sd s, so that θ_arr = θ_c · exp(s z − s²/2) for the path's prime z and
   * E[θ_arr · G_k*(θ_arr)] = primeMu · c̃(a + k*) / c̃(25).
   */
  arrivalCentre(g: GrowthGroup, ageArr: number, pick: number | null, primeMu: number): { theta: number; sd: number };
  /** Arrival level and growth path of one path (prime z-score `z`). */
  arrival(g: GrowthGroup, ageArr: number, pick: number | null, primeMu: number, z: number): { theta: number; path: GrowthPath };
}

/** 7-point Gauss–Hermite rule for a standard normal. */
const GH_X = [-3.750439717725742, -2.366759410734541, -1.154405394739968, 0, 1.154405394739968, 2.366759410734541, 3.750439717725742];
const GH_W = [0.000548268855972, 0.030757123967586, 0.240123178605013, 0.457142857142857, 0.240123178605013, 0.030757123967586, 0.000548268855972];

/** Index pair and weight for linear interpolation over sorted centres (flat outside). */
function interp(centres: readonly number[], x: number): [number, number, number] {
  const n = centres.length;
  if (x <= centres[0]!) return [0, 0, 0];
  if (x >= centres[n - 1]!) return [n - 1, n - 1, 0];
  let i = 0;
  while (x > centres[i + 1]!) i++;
  return [i, i + 1, (x - centres[i]!) / (centres[i + 1]! - centres[i]!)];
}
const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** P(≥ 3 goals) in a game with Poisson(λ) goals. */
const hatTrick = (l: number) => (l > 0 ? 1 - Math.exp(-l) * (1 + l + (l * l) / 2) : 0);

/**
 * FP/G of season lines (one season, any number of teams) under the league
 * scoring as the backtest computed it: 3 G + 2.4 A1 + 1.6 A2 (A1 share by
 * position) + 0.4 SOG + 0.3 Hit + 0.5 × OT points (2.46% of points) + 2 × hat
 * tricks (Poisson); D also 0.3 Blk + 0.35 Tk + 2 × team shutouts (0.05/G).
 */
export function seasonFpgLeague(p: DynastyParams, g: GrowthGroup, lines: readonly SeasonLine[]): { gp: number; fpg: number } | null {
  const s = p.growth.scoring;
  let gp = 0;
  let fp = 0;
  for (const l of lines) {
    if (!(l.gp > 0)) continue;
    const a1 = l.assists * s.A1[g];
    fp +=
      3 * l.goals +
      2.4 * a1 +
      1.6 * (l.assists - a1) +
      0.4 * l.shots +
      0.3 * l.hits +
      0.5 * s.otPerPoint * (l.goals + l.assists) +
      2 * l.gp * hatTrick(l.goals / l.gp);
    if (g === "D") fp += 0.3 * l.blocks + 0.35 * l.takeaways + 2 * s.teamShutoutPerGame * l.gp;
    gp += l.gp;
  }
  return gp > 0 ? { gp, fpg: fp / gp } : null;
}

export function makeGrowth(p: DynastyParams, level: LevelFn): GrowthModel {
  const gp = p.growth;
  const H = gp.horizon;
  const QS = gp.pctQuantiles;
  const ages = {
    F: Object.keys(gp.pctKnots.F).map(Number).sort((a, b) => a - b),
    D: Object.keys(gp.pctKnots.D).map(Number).sort((a, b) => a - b),
  };
  const shareCurve = (g: GrowthGroup, q: number) => 1 + gp.curveShare.gamma[g] * Math.max(0, (q - 0.5) / 0.5) ** 2;

  function pct(g: GrowthGroup, baseAge: number, fpg: number): number {
    const a = clamp(Math.floor(baseAge), ages[g][0]!, ages[g][ages[g].length - 1]!);
    const k = gp.pctKnots[g][String(a)]!;
    if (!(fpg > 0)) return 0.005;
    if (fpg <= k[0]!) return Math.max(0.005, (QS[0]! * fpg) / k[0]!);
    for (let i = 1; i < k.length; i++) {
      if (fpg <= k[i]!) return QS[i - 1]! + ((QS[i]! - QS[i - 1]!) * (fpg - k[i - 1]!)) / (k[i]! - k[i - 1]!);
    }
    return 0.995;
  }

  /** Interpolation state of one base (age, production, pedigree). */
  function cell(g: GrowthGroup, baseAge: number, pick: number | null, fpg: number) {
    const q = pct(g, baseAge, fpg);
    const [a0, a1, wa] = interp(gp.ageCentre[g], baseAge);
    const [m0, m1, wm] = interp(gp.prodCentre, q);
    const pd = gp.pedigree;
    const lp = pick != null && pick > 0 ? Math.log(clamp(pick, 1, 300)) : pd.lnPickUndrafted;
    const [p0, p1, wp] = interp(pd.pctCentre[g], q);
    const [l0, l1, wl] = interp(pd.lnPickCentre[g], lp);
    const C = pd.cell[g];
    const ped = lerp(lerp(C[p0]![l0]!, C[p0]![l1]!, wl), lerp(C[p1]![l0]!, C[p1]![l1]!, wl), wp);
    return { g, baseAge, q, a0, a1, wa, m0, m1, wm, ped, share: shareCurve(g, q), c0: level(g, baseAge) };
  }
  type Cell = ReturnType<typeof cell>;

  /** G_k of a cell. */
  function mk(c: Cell, k: number): number {
    const i = k - 1;
    const A = gp.excessAge[c.g];
    const B = gp.excessProd[c.g];
    const V = gp.meanCorr[c.g];
    const curve = Math.log(level(c.g, c.baseAge + k) / c.c0);
    const ex = lerp(A[c.a0]![i]!, A[c.a1]![i]!, c.wa) + lerp(B[c.m0]![i]!, B[c.m1]![i]!, c.wm) + lerp(V[c.m0]![i]!, V[c.m1]![i]!, c.wm);
    return Math.exp(curve * c.share + ex + c.ped);
  }

  function path(g: GrowthGroup, baseAge: number, pick: number | null, fpg: number): GrowthPath {
    const c = cell(g, baseAge, pick, fpg);
    const m = new Array<number>(H);
    for (let k = 1; k <= H; k++) m[k - 1] = mk(c, k);
    const sg = gp.sigma[g];
    const s0 = lerp(sg[c.m0]!.sigma0, sg[c.m1]!.sigma0, c.wm);
    const sd = gp.prodSd[g];
    const post = lerp(sd[c.m0]!, sd[c.m1]!, c.wm);
    return {
      m,
      pct: c.q,
      prod: gp.prodBands[gp.prodCuts.filter((x) => c.q >= x).length]!,
      ped: c.ped,
      sigma0: Math.sqrt(s0 * s0 + post * post),
      persistent: lerp(sg[c.m0]!.persistent, sg[c.m1]!.persistent, c.wm),
    };
  }

  function arrivalCentre(g: GrowthGroup, ageArr: number, pick: number | null, primeMu: number) {
    const a25 = p.prospect.primeAge;
    const kStar = clamp(Math.round(a25 - ageArr), 1, H);
    const target = (primeMu * level(g, ageArr + kStar)) / level(g, a25);
    const s = gp.arrival.sd[g];
    const expected = (th: number) => {
      let e = 0;
      for (let j = 0; j < GH_X.length; j++) {
        const x = th * Math.exp(s * GH_X[j]! - (s * s) / 2);
        e += GH_W[j]! * x * mk(cell(g, ageArr, pick, x), kStar);
      }
      return e;
    };
    // E[θ G(θ)] rises with θ_c at an elasticity of ~0.5–0.9: damped fixed point in logs
    let theta = (primeMu * level(g, ageArr)) / level(g, a25);
    for (let it = 0; it < 30; it++) {
      const r = target / expected(theta);
      theta *= Math.pow(r, 1.4);
      if (Math.abs(r - 1) < 1e-6) break;
    }
    return { theta, sd: s };
  }

  function arrival(g: GrowthGroup, ageArr: number, pick: number | null, primeMu: number, z: number) {
    const c = arrivalCentre(g, ageArr, pick, primeMu);
    const theta = c.theta * Math.exp(c.sd * z - (c.sd * c.sd) / 2);
    return { theta, path: path(g, ageArr, pick, theta) };
  }

  return { horizon: H, maxBaseAge: gp.maxBaseAge, path, pct, arrivalCentre, arrival };
}

/**
 * Base FP/G of a young NHL skater: the base season's league-scoring FP/G
 * blended in log space with the projection's realized level (for young
 * players the projection maps onto last season's level: mean ln ratio
 * +0.01, sd 0.10), w = GP / (GP + blendK) — precision weights with the base
 * season's noise 0.12 at 82 GP and the projection's 0.18. No base-season
 * games → the projection alone (w = 0). One rule at every games count: the
 * projection is read as the base season's level for rookies too, so one
 * more game moves the base smoothly (no 30-GP switch).
 */
export function youthBase(
  p: DynastyParams,
  g: GrowthGroup,
  projLevel: number,
  history: readonly SeasonLine[] | undefined,
  baseSeason = p.firstSeasonYear - 1,
): { base: number; obs: number | null; gp: number; w: number } {
  const obs = seasonFpgLeague(p, g, (history ?? []).filter((h) => h.season === baseSeason));
  if (!obs || !(obs.fpg > 0)) return { base: Math.max(0.3, projLevel), obs: null, gp: 0, w: 0 };
  if (!(projLevel > 0)) return { base: Math.max(0.3, obs.fpg), obs: obs.fpg, gp: obs.gp, w: 1 };
  const w = obs.gp / (obs.gp + p.growth.blendK);
  return { base: Math.exp(w * Math.log(obs.fpg) + (1 - w) * Math.log(projLevel)), obs: obs.fpg, gp: obs.gp, w };
}

/**
 * Expected FP/G three seasons after the base (G_3) at or above which a young
 * skater reads as progressing, and at or below which as regressing; between
 * them his level is expected to hold ("prime"). Shared by the phase label and
 * the French growth clause so the two never disagree.
 */
export const GROWTH_RISE = 1.05;
export const GROWTH_FALL = 0.95;

/** French pedigree phrase for the growth clause. */
export function pedigreeFr(pick: number | null | undefined): string {
  if (pick == null || !(pick > 0)) return "d’un joueur non repêché";
  if (pick === 1) return "d’un 1er choix au total";
  if (pick <= 3) return "d’un choix du top 3";
  if (pick <= 5) return "d’un choix du top 5";
  if (pick <= 10) return "d’un choix du top 10";
  if (pick <= 32) return "d’un choix de 1re ronde";
  if (pick <= 64) return "d’un choix de 2e ronde";
  return "d’un choix tardif";
}

/** French production phrase (percentile among same-age NHL seasons). */
export function productionFr(pct: number): string {
  if (pct >= 0.97) return "déjà élite";
  if (pct >= 0.9) return "parmi les meilleurs de son âge";
  if (pct >= 0.75) return "très productif";
  if (pct >= 0.5) return "productif";
  if (pct >= 0.25) return "peu productif";
  return "en difficulté";
}
