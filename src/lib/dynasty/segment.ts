/**
 * Routing (§3.2–3.3): which model a player goes through, his market
 * segment, and the year-0 inputs of the path simulation.
 *
 *  1. a real NHL projection with an NHL role      → NHL path
 *  2. a record in the frozen prospect model       → prospect path (record)
 *  3. a real projection for a part-timer          → NHL path
 *  4. drafted at 17–21 and minors-eligible now    → prospect path (draft slot)
 *  5. minors-eligible now, no trusted draft       → prospect path (undrafted:
 *     P(make it) by age, fitted on the undrafted players who made it; was
 *     fringe, so every undrafted signing read 0)
 *  6. otherwise                                   → fringe (market only, or 0)
 *
 * "Real" projection: an ML projection, or a contextual one with ≥ 20 NHL GP.
 * Contextual projections of 0–19 GP players are placeholders (Klepov's 62 GP)
 * and never count as an NHL role.
 *
 * Blended route (2026-09-27): a skater with a prospect record whose NHL
 * role hangs on his projected games (under 100 career GP), when those games
 * come from the split-season rule (a late signing or a call-up:
 * `proj.gpSd`), is valued on both routes, the paths mixed by
 * P(40+ games) = Φ((GP − 40) / gpSd) (≈ 22 GP, the rule's walk-forward
 * spread). A hard cut on that point estimate moved values 4–6× on a game
 * or two (Konsta Helenius, 40.5 raw games: NHL route 123, prospect 30).
 * The route shown (path, phase, segment) is the likelier one; the market
 * layer mixes the two sides' weights by the same shares (market.ts).
 * Each side plays its half of the games (verifier 2026-09-27: the NHL side
 * ran at the unconditional games with its own demotion draw and the prospect
 * side ignored the projection, so year-0 NHL games summed to 0.82 of the
 * projection): the NHL side at E[GP | GP ≥ 40], the prospect side E[GP |
 * GP < 40] games in 2026-27 at the projection's level, then the prospect
 * model from 2027-28 (`blendGames`; the two sum to the projection).
 *
 * Year 0 (audit 2026-09-25): a current injury, IR stint or suspension trims
 * season 0 only (`avail0`); the goalie start share is his depth-chart share
 * with injured partners kept in, so neither an injury flag nor a partner's
 * injury rewrites the role carried into 2027-28.
 *
 * Young skaters (2025-26 at 18–23, growth.ts): year 0 = base × G_1 where
 * the base blends the 2025-26 FP/G with the projection's realized level,
 * w = GP / (GP + 36) — one rule at every games count (the projection reads
 * as the base season's level for rookies too; a 30-GP switch moved paths by
 * 10–20% for one game). The projection's share of the base (1 − w) takes
 * the projection's year-0 error (by career GP) instead of the
 * observed-season band. G follows age × production percentile × pedigree; young-player
 * shocks; no trajectory shift. Everyone else: the projection's realized
 * level × the half-strength year-0 age calibration, then the curve.
 */
import { normalCdf } from "../fantrax/draft";
import { goalieStartShares } from "../fantrax/points-model";
import { ageShift, phaseByAge, trajectoryShift, type LevelFn, type Trajectory } from "./aging";
import { ageAt, birthMs, cutdownAge, isEligible, seasonAnchorMs } from "./eligibility";
import { GROWTH_FALL, GROWTH_RISE, makeGrowth, youthBase, type GrowthModel, type GrowthPath } from "./growth";
import type { DynastyParams } from "./params";
import { recordProspect, slotProspect, undraftedProspect, type ProspectModel } from "./prospect";
import { clamp } from "./rng";
import { groupOf, projectedX, realized, year0Cal } from "./scale";
import type { SimPlayer } from "./simulate";
import type { DynastyFlag, DynastyInput, Group, MarketSeg, PathKind, Phase } from "./types";

export type Route = "nhl" | "prospect" | "nhl-part" | "slot" | "undrafted" | "fringe";

/** Projected games that make an NHL role (skaters / goalies). */
export const SKATER_ROLE_GP = 40;
export const GOALIE_ROLE_GP = 15;

export interface Routed {
  input: DynastyInput;
  g: Group;
  age0: number;
  gp0: number;
  eligNow: boolean;
  route: Route;
  path: PathKind;
  seg: MarketSeg;
  phase: Phase;
  effAge: number;
  traj: Trajectory;
  flags: Set<DynastyFlag>;
  draft: { year: number; pick: number } | null;
  /** Null for fringe players (no model). */
  sim: SimPlayer | null;
  /** Conditional growth of a young NHL-path skater (null otherwise). */
  growth: YouthGrowth | null;
  pm: ProspectModel | null;
  /**
   * Blended route: P(40+ games), the share of paths on the NHL route (the
   * rest on the prospect route); null when one route decides.
   */
  nhlShare: number | null;
  /** Blended route: each side's year-0 games (82-game basis, `blendGames`); null otherwise. */
  blendGp: { above: number; below: number } | null;
}

export interface YouthGrowth {
  /**
   * The base is always the 2025-26 level (year 0 = its first step);
   * "season": ≥ minBaseGp games in 2025-26, the base reads mostly as that
   * season; "projection": fewer, it leans on the projection.
   */
  src: "season" | "projection";
  /** Base FP/G: the 2025-26 FP/G blended with the projection's level (w). */
  base: number;
  /** 2025-26 league-scoring FP/G and games (null / 0 when he did not play). */
  obs: number | null;
  gpBase: number;
  /** The projection's realized level (no age calibration). */
  proj: number;
  /** Weight of the 2025-26 season in the base. */
  w: number;
  /** Age on Oct 1 of the base season. */
  baseAge: number;
  pick: number | null;
  path: GrowthPath;
  /** Expected level of seasons 0 … H − 1 relative to year 0 (the simulator's gRel). */
  rel: number[];
}

/** A young skater's 2025-26 FP/G and projection disagree beyond this (ln) with ≥ 20 GP. */
const CONFLICT_LN = Math.log(1.25);

/** Players projected for at least this share of a season count as regulars now. */
const PROSPECT_PHASE_SHARE = 0.5;

/** Share of season 0 a player is expected to play given his status icons now (1 = healthy). */
export function statusAvailability(p: DynastyParams, icons: readonly string[] | undefined): number {
  let a = 1;
  for (const i of icons ?? []) {
    const v = p.status0.avail[i];
    if (v != null) a = Math.min(a, v);
  }
  return a;
}

export interface DepthGoalie {
  id: string;
  /** Fantrax NHL team ("(N/A)" / "" = no club). */
  team: string;
  /** Projected GP (players.json, 82-game basis). */
  gp: number;
  icons?: readonly string[];
}

/**
 * Depth-chart start share per goalie: projected GP renormalized within his
 * NHL club (capped at 85%), with injured, IR and suspended goalies kept in —
 * an injury is a short absence (status0.avail), not a lost job. Only minors,
 * unsigned and inactive goalies leave the depth chart.
 */
export function depthChartShares(p: DynastyParams, goalies: readonly DepthGoalie[]): Map<string, number> {
  const out = new Set(p.status0.depthIcons);
  return goalieStartShares(
    goalies.map((g) => ({ id: g.id, team: g.team, gp: g.gp, healthy: !(g.icons ?? []).some((i) => out.has(i)) })),
  );
}

/**
 * P(40+ games) of a skater whose route is blended (see the header), else
 * null: a prospect record, a real projection whose games come from the
 * split-season rule, and an NHL role that hangs on those games.
 */
export function nhlRouteShare(
  p: DynastyParams,
  inp: DynastyInput,
  g: Group,
  gp0: number,
  realProj: boolean,
): number | null {
  const sd = inp.proj?.gpSd;
  if (g === "G" || !inp.prospect || !realProj || sd == null || !(sd > 0)) return null;
  if (gp0 >= p.eligibility.skaterGp) return null;
  return normalCdf((inp.proj!.gp - SKATER_ROLE_GP) / sd);
}

const normalPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/**
 * Year-0 games of each side of a blended route, the split-season games read
 * as N(gp, sd) cut at 40: the NHL side E[GP | GP ≥ 40], the prospect side
 * E[GP | GP < 40], so P(40+) · above + (1 − P(40+)) · below = gp (before the
 * clamps to [40, basis] and [0, 40], which only bind in the far tails).
 */
export function blendGames(gp: number, sd: number, basis: number): { above: number; below: number } {
  const a = (SKATER_ROLE_GP - gp) / sd;
  const pBelow = normalCdf(a);
  const phi = normalPdf(a);
  const above = pBelow < 1 - 1e-9 ? gp + (sd * phi) / (1 - pBelow) : SKATER_ROLE_GP;
  const below = pBelow > 1e-9 ? gp - (sd * phi) / pBelow : SKATER_ROLE_GP;
  return { above: clamp(above, SKATER_ROLE_GP, basis), below: clamp(below, 0, SKATER_ROLE_GP) };
}

export function routePlayer(
  p: DynastyParams,
  level: LevelFn,
  inp: DynastyInput,
  remainingShare = 1,
  growthModel: GrowthModel = makeGrowth(p, level),
  /** Blended route: take this side of the cut (the build simulates both). */
  force?: "nhl" | "prospect",
): Routed {
  const proj = inp.proj;
  const rec = inp.prospect;
  const g = groupOf(inp.e, proj?.gE !== undefined, inp.posHint ?? rec?.pos);
  const b = birthMs(inp.birthDate);
  const age0 = b != null ? ageAt(b, seasonAnchorMs(p)) : (inp.fantraxAge ?? 25) + 0.5;
  const birthYear = inp.birthDate ? Number(inp.birthDate.slice(0, 4)) : null;
  // career GP before the season + the games of the season in progress
  const gp0 =
    (inp.careerGp ?? rec?.nhlGP ?? (proj?.src === "proj" && proj.gp >= 40 && age0 >= 26 ? 300 : 0)) +
    Math.max(0, inp.seasonGp ?? 0);
  const eligNow =
    inp.eligNow ?? isEligible(p, g, cutdownAge(p, inp.birthDate, age0, 0), gp0);
  const flags = new Set<DynastyFlag>();

  const realProj = proj?.src === "proj" && (proj.method === "ml" || gp0 >= 20);
  if (proj?.src === "proj" && !realProj) flags.add("placeholderProjection");
  const nhlShare = nhlRouteShare(p, inp, g, gp0, realProj);
  const basis = p.games.projectionBasis;
  const blendGp = nhlShare != null ? blendGames(proj!.gp, proj!.gpSd!, basis) : null;
  const nhlRole =
    nhlShare != null && force
      ? force === "nhl"
      : realProj &&
        (g === "G"
          ? proj!.gp >= GOALIE_ROLE_GP || gp0 >= p.eligibility.goalieGp
          : proj!.gp >= SKATER_ROLE_GP || gp0 >= p.eligibility.skaterGp);
  const [dMin, dMax] = p.prospect.draftAgeRange;
  const draft = inp.draft ?? rec?.draft ?? null;
  // Namesake guard: the draft age must be 17–21. Without a birth date the
  // birth year comes from the Fantrax age (±1); a registry name match with
  // no age at all is not trusted (id-keyed profile / record drafts are).
  const byEst = birthYear ?? (inp.fantraxAge != null ? p.firstSeasonYear - inp.fantraxAge : null);
  const slack = birthYear != null ? 0 : 1;
  const idKeyed = inp.draft ? inp.draftSource !== "registry" : !!rec?.draft;
  const draftOk =
    !!draft &&
    (byEst == null ? idKeyed : draft.year - byEst >= dMin - slack && draft.year - byEst <= dMax + slack);
  const route: Route = nhlRole
    ? "nhl"
    : rec
      ? "prospect"
      : realProj
        ? "nhl-part"
        : draftOk && eligNow
          ? "slot"
          : eligNow && p.prospect.undrafted
            ? "undrafted"
            : "fringe";
  const path: PathKind = route === "nhl" || route === "nhl-part" ? "nhl" : route === "fringe" ? "fringe" : "prospect";

  let sim: SimPlayer | null = null;
  let growth: YouthGrowth | null = null;
  let pm: ProspectModel | null = null;
  let share0 = 0;
  let elite = false;
  const avail0 = statusAvailability(p, inp.status);
  let traj: Trajectory = { shift: 0, toiDelta: null, fpgRatio: null };
  const pick = draftOk ? draft!.pick : null;
  if (path === "nhl") {
    const x = projectedX(g, proj!);
    const calAge = inp.fantraxAge ?? Math.floor(age0);
    const projLevel = realized(p, g, x);
    const baseAge = age0 - 1;
    let theta0: number;
    if (g !== "G" && baseAge < growthModel.maxBaseAge) {
      // 2025-26 is his base season (blended with the projection): year 0 is the first growth step
      const yb = youthBase(p, g, projLevel, inp.history);
      const gpath = growthModel.path(g, baseAge, pick, yb.base);
      const m0 = gpath.m[0]!;
      growth = {
        src: yb.gp >= p.growth.minBaseGp ? "season" : "projection",
        base: yb.base,
        obs: yb.obs,
        gpBase: yb.gp,
        proj: projLevel,
        w: yb.w,
        baseAge,
        pick,
        path: gpath,
        rel: gpath.m.map((m) => m / m0),
      };
      theta0 = Math.max(0.3, yb.base * m0);
      if (yb.obs != null && yb.gp >= 20 && projLevel > 0 && Math.abs(Math.log(yb.obs / projLevel)) > CONFLICT_LN) {
        flags.add("projectionConflict");
      }
    } else theta0 = Math.max(0.3, projLevel * year0Cal(p, g, calAge));
    // pS is the depth-chart share (injured partners kept in): real tandem news only;
    // a blended skater's NHL side plays E[GP | GP ≥ 40] (its half of the split)
    const starts = g === "G" && proj!.pS != null ? Math.min(proj!.gp, proj!.pS * basis) : (blendGp?.above ?? proj!.gp);
    if (g === "G" && proj!.pS != null && proj!.pS * basis < 0.85 * proj!.gp) flags.add("startShareNews");
    share0 = clamp(starts / basis, 0, 1);
    const s0 = p.sigma.sigma0;
    const s0proj = g === "G" ? s0.G : gp0 >= 200 ? s0.gp200 : gp0 >= 40 ? s0.gp40 : s0.low;
    // a young skater: the observed season's band for its weight, the projection's error for the rest
    const sigma0 = growth ? Math.sqrt(growth.w * growth.path.sigma0 ** 2 + (1 - growth.w) * s0proj ** 2) : s0proj;
    elite = g === "F" && theta0 >= p.eliteTheta.value;
    // the growth model replaces the trajectory modifier for young skaters
    if (!growth) traj = trajectoryShift(p, level, g, age0, inp.history);
    sim = {
      id: inp.id,
      g,
      age0,
      birthDate: b != null ? inp.birthDate : null,
      gp0,
      eligNow,
      path: "nhl",
      theta0,
      share0,
      sigma0,
      elite,
      gRel: growth ? growth.rel : null,
      ...(growth ? { spYoung: growth.path.persistent } : {}),
      pick,
      trajShift: traj.shift,
      remainingShare,
      avail0,
    };
  } else if (path === "prospect") {
    pm = route === "slot" ? slotProspect(p, g, draft!) : route === "undrafted" ? undraftedProspect(p, g, age0)! : recordProspect(rec!);
    sim = {
      id: inp.id,
      g,
      age0,
      birthDate: b != null ? inp.birthDate : null,
      gp0,
      eligNow,
      path: "prospect",
      pm,
      pick,
      trajShift: 0,
      remainingShare,
      avail0,
    };
  } else flags.add("noModel");
  if (path === "nhl" && avail0 < 1) flags.add("injuredNow");

  let seg: MarketSeg;
  if (path === "fringe") seg = "fringe";
  else if (route === "undrafted") {
    seg = "prospect_undrafted";
    flags.add("undrafted");
  }
  else if (g === "G") seg = path === "prospect" ? "G_prospect" : gp0 >= p.eligibility.goalieGp ? "G_est" : "G_young";
  else if (route === "slot") seg = "prospect_slot";
  else if (path === "prospect") seg = gp0 > 0 ? "prospect_nhl" : "prospect";
  else seg = age0 < 24 ? "young_nhl" : age0 < 31 ? "established" : age0 < 34 ? "veteran" : "late";

  const effAge = Math.floor(age0 + 0.25) + ageShift(p, g, age0, elite, traj.shift);
  let phase: Phase =
    path === "prospect" || (eligNow && share0 < PROSPECT_PHASE_SHARE) ? "prospect" : phaseByAge(p, g, effAge);
  // A young skater's phase follows his own expected path, not his age alone
  // (G_3, three seasons after the base, as the growth clause quotes it): an
  // elite teenager whose level is expected to hold is already "in his
  // prime", a 22-year-old coming off an outlier season is on a plateau, a
  // 24-year-old still expected to grow is entering his prime.
  if (growth && (phase === "rising" || phase === "entering_prime" || phase === "prime")) {
    const g3 = growth.path.m[2]!;
    if (g3 <= GROWTH_FALL) phase = "plateau";
    else if (g3 < GROWTH_RISE) phase = "prime";
    else if (phase === "prime") phase = "entering_prime";
  }

  return {
    input: inp,
    g,
    age0,
    gp0,
    eligNow,
    route,
    path,
    seg,
    phase,
    effAge,
    traj,
    flags,
    draft: draftOk ? draft : null,
    sim,
    growth,
    pm,
    nhlShare,
    blendGp,
  };
}
