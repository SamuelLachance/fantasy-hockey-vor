/**
 * Typed view of src/data/dynasty/params.json — the frozen research tables
 * (scale fit, aging curves, retention logistics, keeper rules, modes,
 * market weights). The JSON object is passed in by the caller; nothing here
 * reads a file, so the library stays pure and testable.
 */
import type { Group, Mode, Phase } from "./types";

interface Sourced {
  source: string;
}

export interface Curve {
  age0: number;
  values: number[];
}

export interface DynastyParams {
  version: string;
  season: string;
  firstSeasonYear: number;
  T: number;
  source: string;
  scale: Sourced & {
    F: { a: number; b: number; n?: number; r?: number };
    D: { a: number; b: number; n?: number; r?: number };
    waiverLineProj: { F: number; D: number };
    offRefProj: number;
  };
  repl: Sourced & { Gseason: number; GseasonRange: [number, number] };
  year0AgeCal: Sourced & { bands: string[]; F: number[]; D: number[] };
  lambda: Sourced & { value: number };
  sigma: Sourced & {
    sigma0: { gp200: number; gp40: number; low: number; G: number };
    persistent: Record<Group, number>;
    season: Record<Group, number>;
    goalieShare0: number;
  };
  curves: Sourced & Record<Group, Curve>;
  availability: Sourced & Record<"F" | "D", Array<{ age: number; pRegularNext: number; pPresentNext: number }>>;
  retentionLogistic: Sourced & { features: string[]; F: number[]; D: number[] };
  /**
   * Goalie role next season on the raw games-started share: P(starter ≥ 50%),
   * P(at least a tandem ≥ 30%) and P(present), same features.
   */
  starterLogistic: Sourced & { features: string[]; beta: number[]; tandemBeta: number[]; presentBeta: number[] };
  phasesByAge: Sourced & Record<Group, Record<string, Exclude<Phase, "prospect">>>;
  ladder: Sourced & Record<"F" | "D", { n: number; rows: Array<[number, number]> }>;
  eliteTheta: Sourced & { value: number; fromAge: number };
  games: Sourced & {
    regShareMean: number;
    share0Floor: number;
    regular: [number, number];
    partial: [number, number];
    absentYear0: number;
    retireIfOutAge: number;
    /** Games in an NHL regular season from 2026-27 (84). */
    seasonGames: number;
    /** Season length the projections' games are a share of (82). */
    projectionBasis: number;
    /** Per-season persistence of a durable player's above-mean share. */
    durabilityCarry: number;
    goalie: {
      /** A starter's next share: max(min, a + b × last share + sd × z), capped at maxShare. */
      starterNext: { a: number; b: number; sd: number; min: number };
      /** Tandem share U(lo, lo + width). */
      tandem: [number, number];
      /** Backup share U(lo, lo + width). */
      backup: [number, number];
      retireIfOutAge: number;
      firstSeason: [number, number];
      appearancesPerStart: number;
      /** FP/start ≈ svLeague + svWorkload × raw start share + svFpPerPt × sv% points above league. */
      svLeague: number;
      svWorkload: number;
      svFpPerPt: number;
      maxShare: number;
    };
    prospectFirstSeason: { pRegular: number; fringeMax: number };
  };
  /** Year-0 availability for a current status icon, and the goalie depth-chart icons. */
  status0: Sourced & { avail: Record<string, number>; depthIcons: string[] };
  prospect: Sourced & {
    slotPMake: { F: { a: number; b: number }; D: { a: number; b: number }; G: Array<[number, number]> };
    slotPrime: {
      F: { a: number; b: number; sd: number };
      D: { a: number; b: number; sd: number };
      G: { mu: number; sd: number };
    };
    undraftedPrior: { F: number; D: number };
    decay: number[];
    etaLag: Array<[number, number]>;
    etaLagGoalie: number;
    etaJitter: Array<[number, number]>;
    primeFloor: Record<Group, number>;
    primeAge: number;
    draftAgeRange: [number, number];
  };
  /**
   * Conditional growth of young skaters (base season at 18–23), fitted on the
   * 2008-26 backtest (see growth.ts): the curve's growth from the base age
   * (a share of it for above-median producers), the pooled excess by age
   * band, regression to the mean by production band and a pedigree slope.
   */
  growth: Sourced & {
    /** The model applies to base ages below this (Oct 1 of the base season). */
    maxBaseAge: number;
    /** Seasons of conditional growth after the base season (then the curve). */
    horizon: number;
    /** Weight of the base-season FP/G vs the projection: w = GP / (GP + blendK). */
    blendK: number;
    /** Base-season games from which the base reads as observed (label only: the blend weight is continuous). */
    minBaseGp: number;
    scoring: { A1: Record<"F" | "D", number>; otPerPoint: number; teamShutoutPerGame: number };
    /** Mean base age of each age band. */
    ageCentre: Record<"F" | "D", number[]>;
    prodBands: string[];
    prodCuts: number[];
    /** Mean production percentile of each production band. */
    prodCentre: number[];
    pctQuantiles: number[];
    /** FP/G at pctQuantiles by position and integer base age. */
    pctKnots: Record<"F" | "D", Record<string, number[]>>;
    /** [age band][k − 1] pooled excess over the curve (ln). */
    excessAge: Record<"F" | "D", number[][]>;
    /** [production band][k − 1] regression to the mean (ln). */
    excessProd: Record<"F" | "D", number[][]>;
    prodN: Record<"F" | "D", number[]>;
    n0: Record<"F" | "D", number>;
    /** Share of the curve's growth: × (1 + γ · max(0, (pct − 0.5) / 0.5)²). */
    curveShare: { form: string; gamma: Record<"F" | "D", number>; fit?: unknown };
    /**
     * Pedigree × production surface (ln G, every k): bilinear over the
     * pedigree centres (mean ln pick of top-10 / 11-32 / 33+ and undrafted)
     * and the production centres (mean pct of <p50 / p50-75 / p75+), flat
     * outside; cell[production][pedigree].
     */
    pedigree: {
      form?: string;
      lnPickUndrafted: number;
      lnPickCentre: Record<"F" | "D", number[]>;
      pctCentre: Record<"F" | "D", number[]>;
      cell: Record<"F" | "D", number[][]>;
      fit?: unknown;
    };
    /** Prospect arrival: log sd of the arrival level around its centre (historical first NHL seasons, net of season noise). */
    arrival: { sd: Record<"F" | "D", number>; source?: string };
    /** [production band][k − 1] v_k / 2: the lognormal mean correction (the path shocks are mean-one). */
    meanCorr: Record<"F" | "D", number[][]>;
    /** Posterior sd of the production band's effect (ln). */
    prodSd: Record<"F" | "D", number[]>;
    /** Year-0 and persistent shocks of a young skater by production band. */
    sigma: Record<"F" | "D", Array<{ sigma0: number; persistent: number }>>;
  };
  trajectory: Sourced & {
    minAge: number;
    minGp: number;
    toiSec: number;
    fpgExcess: number;
    fp: { goals: number; assists: number; shots: number; hits: number; dBlocks: number; dTakeaways: number };
  };
  cutdown: Sourced & { month: number; day: number; window: [string, string] };
  eligibility: Sourced & { skaterGp: number; goalieGp: number; age: number };
  K: Sourced & {
    rank: number;
    band: [number, number];
    fallback: number;
    pass1Paths: number;
    keepDelta: number;
    lookahead: number;
    shareFloor: number;
    shareFactor: number;
    shareIfOut: number;
    /** Goalies: no share floor in the keep index (a backup is valued as a backup). */
    goalieShareFloor: number;
    /** Keeper slots per team (team-conditional odds). */
    teamSlots: number;
  };
  /** DV = Σ_t w_t δ^t E[G_t]: w_0 = w0, w_1 = w1 (default 1), w_t = 1 after. */
  modes: Sourced & Record<Mode, { delta: number; w0: number; w1?: number }>;
  market: Sourced & {
    enabled: boolean;
    adpMissing: number;
    offset: number;
    capRatio: number;
    weights: Record<string, number>;
  };
  output: Sourced & { minLongTerm: number };
}

const REQUIRED_BLOCKS = [
  "scale",
  "repl",
  "year0AgeCal",
  "lambda",
  "sigma",
  "curves",
  "availability",
  "retentionLogistic",
  "starterLogistic",
  "phasesByAge",
  "ladder",
  "eliteTheta",
  "games",
  "status0",
  "prospect",
  "growth",
  "trajectory",
  "cutdown",
  "eligibility",
  "K",
  "modes",
  "market",
  "output",
] as const;

/** Validate the parsed params.json (every block present and sourced). */
export function parseParams(raw: unknown): DynastyParams {
  if (!raw || typeof raw !== "object") throw new Error("dynasty params: not an object");
  const p = raw as Record<string, unknown>;
  if (typeof p.version !== "string") throw new Error("dynasty params: version missing");
  for (const k of REQUIRED_BLOCKS) {
    const b = p[k] as { source?: unknown } | undefined;
    if (!b || typeof b !== "object") throw new Error(`dynasty params: block ${k} missing`);
    if (typeof b.source !== "string" || !b.source) throw new Error(`dynasty params: block ${k} has no source`);
  }
  const params = raw as DynastyParams;
  for (const g of ["F", "D", "G"] as const) {
    const c = params.curves[g];
    if (!c?.values?.length || !c.values.every((x) => Number.isFinite(x) && x > 0)) {
      throw new Error(`dynasty params: curve ${g} invalid`);
    }
  }
  if (params.retentionLogistic.F.length !== params.retentionLogistic.features.length) {
    throw new Error("dynasty params: retention beta / features length mismatch");
  }
  return params;
}
