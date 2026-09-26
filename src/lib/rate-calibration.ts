import { clampSkaterProjection } from "./projection-sanity";
import type { ModelSegment, Position, SkaterCategory, SkaterProjection } from "./types";
import { SKATER_CATEGORIES } from "./types";

/**
 * Post-hoc per-game rate calibration of the v2 skater projections.
 *
 * Every v2 skater rate is `market + edge`: a synthetic market (0.5 Marcel +
 * 0.3 EWMA + 0.2 lag-1, era-adjusted) plus the residual models' edge. The
 * market carries the level (an out-of-sample Marcel backtest has ~0 bias and
 * slope ~1 for every stat); the edge says who beats the market. The
 * 2026-07-30 regeneration broke that: with the same bundle and code as the
 * healthy 2026-07-21 board (commit 5291e33), the edge gained an almost
 * constant +0.11 goals, +0.13 assists and +0.53 shots per game for every
 * veteran forward (13,159 projected skater goals against ~8,000 in a
 * season), most likely a dataset.json that no longer matched training (the
 * file is gitignored and gone, so the exact input cannot be inspected).
 *
 * The drift differs by meta-learner segment. The v2 meta has four:
 * young (≤ 2 eligible NHL seasons, predict-v2) or veteran, × F / D. Young
 * forwards drifted less (goals +5.2 per 82 against +9.4 for veterans),
 * young defensemen more on shots (+62 against +39). A single F / D shift
 * over-corrected young forwards by ~20% on goals and PPP and under-corrected
 * young D shots, so the calibration works per segment.
 *
 * Per stat × segment, over the v2 skaters with 40+ projected games, the
 * calibration fits the raw edge against the market (edge ≈ a + b·market; a
 * plain mean, b = 0, except for RATE_LINE_STATS whose drift also tilted
 * with the market) and moves it onto the same fit of a healthy reference
 * board generated with the same bundle (src/data/ml/rate-reference.json,
 * `npm run rates:reference`):
 *   shift(market) = (a_raw − a_ref) + (b_raw − b_ref)·market
 *   rate' = rate − shift, edge' = edge − shift.
 * Keeping the reference's own edge keeps the model's legitimate growth and
 * decline terms (young forwards beat a no-growth market by ~0.6 goals per
 * 82; the Marcel market over-projects veteran D hits by ~13 per 82). Without
 * a reference for the running bundle the target is a zero edge. The market
 * (rate − edge) is unchanged, so the model's ordering inside a segment is
 * kept apart from the small line tilt. Faceoffs are calibrated on centers
 * only (other positions keep their rate).
 *
 * The raw model rates (`modelRates`, uncapped), edges (`modelMarketEdge`)
 * and segment (`modelSegment`) are kept beside the projection, so every run
 * recalibrates from them: the step is idempotent, like `gp:recalibrate`
 * with `modelGamesPlayed`. Totals are round(rate' × gamesPlayed), re-clamped
 * at the calibrated games.
 */

export const RATE_CALIBRATION_VERSION = 2 as const;

/** Players with at least this many projected games fit the calibration. */
export const RATE_CALIBRATION_MIN_GP = 40;

/** A meta segment with fewer regulars than this is fit with its F / D group. */
export const RATE_SEGMENT_MIN_POOL = 25;

export type RateGroup = "F" | "D";
export type { ModelSegment };
export type RateSegment = "vetF" | "youngF" | "vetD" | "youngD";
export type RateKey = RateSegment | RateGroup;

export const RATE_SEGMENTS: readonly RateSegment[] = ["vetF", "youngF", "vetD", "youngD"];
export const RATE_KEYS: readonly RateKey[] = [...RATE_SEGMENTS, "F", "D"];

/**
 * Stats whose drift is removed as a line against the market. The drift of
 * PPP, shots and blocks also tilted with the market (PPP slope −0.15 for
 * veteran forwards against −0.06 on the healthy board); a line fit halves
 * the per-player error left after a plain mean for those three and does not
 * help the others.
 */
export const RATE_LINE_STATS: readonly SkaterCategory[] = ["powerplayPoints", "shots", "blocks"];

export type SkaterRates = Record<SkaterCategory, number>;

/** Per-game edge ≈ a + b·market. */
export interface EdgeLine {
  a: number;
  b: number;
}

export type EdgeLines = Record<RateKey, Partial<Record<SkaterCategory, EdgeLine>>>;

/** Edge fit of a healthy board (src/data/ml/rate-reference.json). */
export interface RateReference {
  version: 1;
  /** `trainedAt` of the v2 bundle the reference board was generated with. */
  bundleTrainedAt: string;
  /** Where the reference edges come from (board commit, pool). */
  source: string;
  fittedAt: string;
  /** Reference players per key (current pool ∩ reference board). */
  poolSize: Record<RateKey, number>;
  lines: EdgeLines;
}

export interface RateCalibrationParams {
  version: typeof RATE_CALIBRATION_VERSION;
  /** Players in the fit per key (segments and their F / D groups). */
  poolSize: Record<RateKey, number>;
  /** Key each segment is calibrated with: its own, or its group when too small. */
  keyOf: Record<RateSegment, RateKey>;
  /** Raw edge fit per key × stat (b = 0 outside RATE_LINE_STATS). */
  raw: EdgeLines;
  /** Target edge per key × stat: the healthy reference, or zero. */
  target: EdgeLines;
  /** Provenance of the target ("zero" without a reference). */
  targetSource: string;
}

export interface RateCalibrationMeta extends RateCalibrationParams {
  appliedAt: string;
  /** Skaters recalibrated (the v2 skaters carrying modelRates). */
  calibrated: number;
  /** One-time legacy bootstrap of the raw model state (rates:recalibrate). */
  bootstrap?: RateBootstrapMeta;
}

export interface RateBootstrapMeta {
  appliedAt: string;
  players: number;
  /** Cells a legacy rate cap had clipped, restored to market + edge. */
  uncappedCells: number;
  /** Cells whose market input was grossly corrupted: rebuilt market, no edge. */
  repairedCells: number;
  /** Cells moved onto a reliable market rebuild by more than rounding. */
  rebasedCells: number;
  /** Players whose rebuild was reliable enough to overrule the board. */
  reliablePlayers: number;
}

/** Fields the calibration reads; generic so callers keep their own type. */
export interface RateCalibratable {
  id: number;
  isGoalie: boolean;
  position: Position;
  primaryPosition?: Position;
  gamesPlayed: number;
  projectionMethod?: string;
  projection: unknown;
  /** Raw model per-game rates, before any rate cap (idempotence anchor). */
  modelRates?: Partial<Record<SkaterCategory, number>>;
  /**
   * Raw model − market per game (idempotence anchor). A stat missing here
   * has no usable edge (its market input was corrupted, see
   * bootstrapModelRates): its raw rate is the market, the calibration gives
   * it the target edge and the fit ignores it.
   */
  modelMarketEdge?: Partial<Record<SkaterCategory, number>>;
  /** v2 meta segment the raw rates came from. */
  modelSegment?: ModelSegment;
  marketEdge?: Partial<Record<string, number>>;
}

function hasEdge(p: Pick<RateCalibratable, "modelMarketEdge">, cat: SkaterCategory): boolean {
  const e = p.modelMarketEdge?.[cat];
  return typeof e === "number" && Number.isFinite(e);
}

export function rateGroup(p: Pick<RateCalibratable, "position" | "primaryPosition">): RateGroup {
  return (p.primaryPosition ?? p.position) === "D" ? "D" : "F";
}

/** The player's meta segment key, or null when its segment is unknown. */
export function rateSegment(
  p: Pick<RateCalibratable, "position" | "primaryPosition" | "modelSegment">,
): RateSegment | null {
  if (p.modelSegment !== "young" && p.modelSegment !== "vet") return null;
  return `${p.modelSegment}${rateGroup(p)}` as RateSegment;
}

/** Segment recorded in the v2 reasoning string (boards before modelSegment). */
export function segmentFromReasoning(reasoning: string | undefined): ModelSegment | undefined {
  if (!reasoning || !reasoning.startsWith("v2 stacked ensemble")) return undefined;
  return /young segment/.test(reasoning) ? "young" : "vet";
}

function isCenter(p: Pick<RateCalibratable, "position" | "primaryPosition">): boolean {
  return (p.primaryPosition ?? p.position) === "C";
}

function hasModelState(p: RateCalibratable): boolean {
  return !p.isGoalie && p.modelRates != null && p.modelMarketEdge != null;
}

function num(v: number | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function zeroRates(): SkaterRates {
  return Object.fromEntries(SKATER_CATEGORIES.map((c) => [c, 0])) as SkaterRates;
}

function emptyLines(): EdgeLines {
  return Object.fromEntries(RATE_KEYS.map((k) => [k, {}])) as unknown as EdgeLines;
}

function zeroCounts(): Record<RateKey, number> {
  return Object.fromEntries(RATE_KEYS.map((k) => [k, 0])) as Record<RateKey, number>;
}

/** Ordinary least squares y ≈ a + b·x (b = 0 when x has no spread). */
export function fitLine(x: number[], y: number[]): EdgeLine {
  const n = Math.min(x.length, y.length);
  if (n === 0) return { a: 0, b: 0 };
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i];
    my += y[i];
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  const b = sxx > 1e-12 ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/** One player's per-game market and edge, for an edge fit. */
export interface EdgeSample {
  group: RateGroup;
  segment: RateSegment | null;
  center: boolean;
  /** Per-game market (stats without a usable edge are left out). */
  market: Partial<Record<SkaterCategory, number>>;
  edge: Partial<Record<SkaterCategory, number>>;
}

/**
 * Edge fit per key × stat: a line against the market for RATE_LINE_STATS,
 * the mean edge (b = 0) otherwise; faceoffs on centers only, none for D.
 * Keys are the four segments and the two F / D groups (every sample counts
 * in its group, and in its segment when known).
 */
export function fitEdgeLines(samples: EdgeSample[]): {
  lines: EdgeLines;
  poolSize: Record<RateKey, number>;
} {
  const lines = emptyLines();
  const poolSize = zeroCounts();
  for (const key of RATE_KEYS) {
    const members = samples.filter((s) => s.group === key || s.segment === key);
    poolSize[key] = members.length;
    const isD = key === "D" || key.endsWith("D");
    for (const cat of SKATER_CATEGORIES) {
      if (cat === "faceoffWins" && isD) continue;
      const withEdge = (cat === "faceoffWins" ? members.filter((s) => s.center) : members).filter(
        (s) => typeof s.edge[cat] === "number" && typeof s.market[cat] === "number",
      );
      if (withEdge.length === 0) continue;
      const x = withEdge.map((s) => s.market[cat] as number);
      const y = withEdge.map((s) => s.edge[cat] as number);
      if (RATE_LINE_STATS.includes(cat)) {
        lines[key][cat] = fitLine(x, y);
      } else {
        lines[key][cat] = { a: y.reduce((s, v) => s + v, 0) / y.length, b: 0 };
      }
    }
  }
  return { lines, poolSize };
}

/** Edge-fit sample of a player carrying raw model state. */
export function edgeSample(p: RateCalibratable): EdgeSample {
  const market: Partial<Record<SkaterCategory, number>> = {};
  const edge: Partial<Record<SkaterCategory, number>> = {};
  for (const cat of SKATER_CATEGORIES) {
    if (!hasEdge(p, cat)) continue;
    const e = num(p.modelMarketEdge?.[cat]);
    market[cat] = num(p.modelRates?.[cat]) - e;
    edge[cat] = e;
  }
  return { group: rateGroup(p), segment: rateSegment(p), center: isCenter(p), market, edge };
}

/** v2 skaters that fit the calibration. */
function fitPool<T extends RateCalibratable>(players: T[]): T[] {
  return players.filter(
    (p) => hasModelState(p) && p.projectionMethod === "ml" && p.gamesPlayed >= RATE_CALIBRATION_MIN_GP,
  );
}

/**
 * Fit the calibration on the v2 skaters with RATE_CALIBRATION_MIN_GP+ games,
 * from their raw model state, against a reference (null: zero target).
 */
export function fitRateCalibration(
  players: RateCalibratable[],
  reference: RateReference | null = null,
): RateCalibrationParams {
  const { lines: raw, poolSize } = fitEdgeLines(fitPool(players).map(edgeSample));
  const keyOf = Object.fromEntries(
    RATE_SEGMENTS.map((s) => [s, poolSize[s] >= RATE_SEGMENT_MIN_POOL ? s : (s.endsWith("D") ? "D" : "F")]),
  ) as Record<RateSegment, RateKey>;
  const target = emptyLines();
  if (reference) {
    for (const key of RATE_KEYS) target[key] = { ...(reference.lines[key] ?? {}) };
  }
  return {
    version: RATE_CALIBRATION_VERSION,
    poolSize,
    keyOf,
    raw,
    target,
    targetSource: reference ? reference.source : "zero",
  };
}

/** Key a player is calibrated with. */
export function calibrationKey(
  p: Pick<RateCalibratable, "position" | "primaryPosition" | "modelSegment">,
  params: Pick<RateCalibrationParams, "keyOf">,
): RateKey {
  const seg = rateSegment(p);
  return seg ? params.keyOf[seg] : rateGroup(p);
}

function lineAt(line: EdgeLine | undefined, market: number): number {
  return line ? line.a + line.b * market : 0;
}

/** Target edge (per game) of one cell at a given market. */
export function targetEdge(
  cat: SkaterCategory,
  market: number,
  p: Pick<RateCalibratable, "position" | "primaryPosition" | "modelSegment">,
  params: RateCalibrationParams,
): number {
  if (cat === "faceoffWins" && !isCenter(p)) return 0;
  return lineAt(params.target[calibrationKey(p, params)][cat], market);
}

/** Per-game shift the calibration removes from one player's rate and edge. */
export function rateShift(
  cat: SkaterCategory,
  rate: number,
  edge: number,
  p: Pick<RateCalibratable, "position" | "primaryPosition" | "modelSegment">,
  params: RateCalibrationParams,
): number {
  if (cat === "faceoffWins" && !isCenter(p)) return 0;
  const key = calibrationKey(p, params);
  const market = rate - edge;
  return lineAt(params.raw[key][cat], market) - lineAt(params.target[key][cat], market);
}

/** Calibrated per-game rates and edges of one player (market unchanged). */
export function calibrateRates(
  p: Pick<
    RateCalibratable,
    "position" | "primaryPosition" | "modelSegment" | "modelRates" | "modelMarketEdge"
  >,
  params: RateCalibrationParams,
): { rates: SkaterRates; edge: SkaterRates } {
  const rates = zeroRates();
  const edge = zeroRates();
  for (const cat of SKATER_CATEGORIES) {
    const r = num(p.modelRates?.[cat]);
    if (!hasEdge(p, cat)) {
      // No usable edge: the raw rate is the market; give it the target edge.
      const t = targetEdge(cat, r, p, params);
      rates[cat] = Math.max(0, r + t);
      edge[cat] = t;
      continue;
    }
    const e = num(p.modelMarketEdge?.[cat]);
    const shift = rateShift(cat, r, e, p, params);
    rates[cat] = Math.max(0, r - shift);
    edge[cat] = e - shift;
  }
  return { rates, edge };
}

/** Season totals from per-game rates, clamped at the position's rate limits. */
export function totalsFromRates(
  rates: SkaterRates,
  gamesPlayed: number,
  position: Position,
): SkaterProjection {
  const gp = Math.max(0, gamesPlayed);
  const totals = Object.fromEntries(
    SKATER_CATEGORIES.map((c) => [c, Math.max(0, Math.round(rates[c] * gp))]),
  ) as unknown as SkaterProjection;
  if (position === "D") totals.faceoffWins = 0;
  return clampSkaterProjection(totals, gp, position);
}

/** Round a rate record for the published JSON (5 decimals ≈ 0.0004 per 82 games). */
export function roundRates(
  rates: Partial<Record<SkaterCategory, number>>,
): Partial<Record<SkaterCategory, number>> {
  const out: Partial<Record<SkaterCategory, number>> = {};
  for (const cat of SKATER_CATEGORIES) {
    const v = rates[cat];
    if (typeof v === "number" && Number.isFinite(v)) out[cat] = Math.round(v * 1e5) / 1e5;
  }
  return out;
}

/**
 * Recalibrate every skater that carries raw model state; everyone else
 * (goalies, contextual / AI skaters) is returned untouched. Pure and
 * idempotent: the output depends only on modelRates, modelMarketEdge,
 * modelSegment, gamesPlayed, position and the reference, never on the
 * previous projection.
 */
export function applyRateCalibration<T extends RateCalibratable>(
  players: T[],
  opts: { params?: RateCalibrationParams; reference?: RateReference | null } = {},
): { players: T[]; params: RateCalibrationParams; calibrated: number } {
  const params = opts.params ?? fitRateCalibration(players, opts.reference ?? null);
  let calibrated = 0;
  const out = players.map((p): T => {
    if (!hasModelState(p)) return p;
    calibrated++;
    const position = p.primaryPosition ?? p.position;
    const { rates, edge } = calibrateRates(p, params);
    return {
      ...p,
      projection: totalsFromRates(rates, p.gamesPlayed, position),
      marketEdge: roundRates(edge),
    } as T;
  });
  return { players: out, params, calibrated };
}

/**
 * Largest mean shift relative to the pool's mean raw rate, per segment key,
 * over the scoring stats. A healthy regeneration of the reference's bundle
 * stays within a few percent; the 2026-07-30 board had +50% on veteran
 * forward goals.
 */
export function driftShare(
  players: RateCalibratable[],
  params: RateCalibrationParams,
  cats: SkaterCategory[] = ["goals", "assists", "shots", "powerplayPoints"],
): { key: RateKey; cat: SkaterCategory; share: number } {
  let worst: { key: RateKey; cat: SkaterCategory; share: number } = {
    key: "F",
    cat: cats[0] ?? "goals",
    share: 0,
  };
  const pool = fitPool(players);
  const keys = new Set<RateKey>(pool.map((p) => calibrationKey(p, params)));
  for (const key of keys) {
    const sub = pool.filter((p) => calibrationKey(p, params) === key);
    for (const cat of cats) {
      const withEdge = sub.filter((p) => hasEdge(p, cat));
      if (withEdge.length === 0) continue;
      const mean = withEdge.reduce((s, p) => s + num(p.modelRates?.[cat]), 0) / withEdge.length;
      if (!(mean > 0)) continue;
      const shift =
        withEdge.reduce(
          (s, p) => s + rateShift(cat, num(p.modelRates?.[cat]), num(p.modelMarketEdge?.[cat]), p, params),
          0,
        ) / withEdge.length;
      const share = Math.abs(shift) / mean;
      if (share > worst.share) worst = { key, cat, share };
    }
  }
  return worst;
}

/** Mean shift per 82 games of one key × stat over its fit pool (for logs). */
export function meanShiftPer82(
  players: RateCalibratable[],
  params: RateCalibrationParams,
  key: RateKey,
  cat: SkaterCategory,
): number {
  const sub = fitPool(players).filter(
    (p) => calibrationKey(p, params) === key && hasEdge(p, cat) && (cat !== "faceoffWins" || isCenter(p)),
  );
  if (sub.length === 0) return 0;
  const s = sub.reduce(
    (acc, p) => acc + rateShift(cat, num(p.modelRates?.[cat]), num(p.modelMarketEdge?.[cat]), p, params),
    0,
  );
  return (s / sub.length) * 82;
}

function roundLines(lines: EdgeLines): EdgeLines {
  const round = (v: number) => Math.round(v * 1e9) / 1e9;
  const out = emptyLines();
  for (const key of RATE_KEYS) {
    for (const [cat, l] of Object.entries(lines[key] ?? {})) {
      if (l) out[key][cat as SkaterCategory] = { a: round(l.a), b: round(l.b) };
    }
  }
  return out;
}

/** Serializable provenance block written to players.json. */
export function rateCalibrationMeta(
  params: RateCalibrationParams,
  calibrated: number,
  appliedAt = new Date().toISOString(),
  bootstrap?: RateBootstrapMeta,
): RateCalibrationMeta {
  return {
    version: params.version,
    appliedAt,
    calibrated,
    poolSize: params.poolSize,
    keyOf: params.keyOf,
    raw: roundLines(params.raw),
    target: roundLines(params.target),
    targetSource: params.targetSource,
    ...(bootstrap ? { bootstrap } : {}),
  };
}

// ---------------------------------------------------------------------------
// Level guard: calibrated projections against the no-growth market.

/**
 * Bounds of Σ calibrated total / Σ market × GP per segment × stat, over the
 * v2 regulars. The market is a no-growth forecast (Marcel-style blend of past
 * seasons), so a veteran segment sits near 1 and a young one a little above
 * (young forwards grow ~8% a season). Calibrated onto the healthy
 * reference board the 2026-27 projections sit at 0.96-1.05 for veterans and
 * 1.04-1.10 for young players on the scoring stats, and 0.83-0.96 on D hits
 * / blocks (the market over-projects them). The pooled F / D calibration of
 * 2026-09 put young forwards at 0.80 on goals (0.76 on PPP) and young D at
 * 1.30 on shots; the uncalibrated 2026-07-30 board had 1.52 on veteran
 * forward goals.
 */
export const SEGMENT_LEVEL_BOUNDS: Record<
  ModelSegment,
  Partial<Record<SkaterCategory, readonly [number, number]>>
> = {
  vet: {
    goals: [0.9, 1.1],
    assists: [0.9, 1.1],
    powerplayPoints: [0.9, 1.12],
    shots: [0.9, 1.1],
    hits: [0.75, 1.15],
    blocks: [0.75, 1.15],
  },
  young: {
    goals: [0.95, 1.2],
    assists: [0.95, 1.2],
    powerplayPoints: [0.95, 1.2],
    shots: [0.95, 1.2],
    hits: [0.75, 1.15],
    blocks: [0.75, 1.15],
  },
};

export interface SegmentLevel {
  segment: RateSegment;
  cat: SkaterCategory;
  players: number;
  ratio: number;
  bounds: readonly [number, number];
}

/**
 * Σ published total / Σ no-growth market × GP per segment × stat over the v2
 * regulars (RATE_CALIBRATION_MIN_GP+). The market of a cell is its raw rate
 * minus its raw edge (the raw rate itself where no edge is usable).
 */
export function segmentLevels(
  players: Array<RateCalibratable & { projection: SkaterProjection | unknown }>,
): SegmentLevel[] {
  const out: SegmentLevel[] = [];
  const pool = fitPool(players);
  for (const segment of RATE_SEGMENTS) {
    const sub = pool.filter((p) => rateSegment(p) === segment);
    const young = segment.startsWith("young");
    const bounds = SEGMENT_LEVEL_BOUNDS[young ? "young" : "vet"];
    for (const [cat, b] of Object.entries(bounds) as Array<[SkaterCategory, readonly [number, number]]>) {
      let proj = 0;
      let market = 0;
      for (const p of sub) {
        const r = num(p.modelRates?.[cat]);
        const m = hasEdge(p, cat) ? r - num(p.modelMarketEdge?.[cat]) : r;
        proj += num((p.projection as Record<string, number>)[cat]);
        market += Math.max(0, m) * p.gamesPlayed;
      }
      if (sub.length === 0 || !(market > 0)) continue;
      out.push({ segment, cat, players: sub.length, ratio: proj / market, bounds: b });
    }
  }
  return out;
}

/** Segment × stat levels outside SEGMENT_LEVEL_BOUNDS (segments of 10+ regulars). */
export function segmentLevelIssues(
  players: Array<RateCalibratable & { projection: SkaterProjection | unknown }>,
): string[] {
  return segmentLevels(players)
    .filter((l) => l.players >= 10 && (l.ratio < l.bounds[0] || l.ratio > l.bounds[1]))
    .map(
      (l) =>
        `${l.segment} ${l.cat}: projection / no-growth market ${l.ratio.toFixed(3)} outside [${l.bounds[0]}, ${l.bounds[1]}] (${l.players} regulars)`,
    );
}

// ---------------------------------------------------------------------------
// Bootstrap of boards generated before the rate caps were raised.

/**
 * Per-game rate limits clampSkaterProjection used until 2026-09 (only the
 * cells that ever bound): D goals 0.18 (14.8 per 82, below Makar, Werenski,
 * Bouchard, Dahlin, Schaefer, Chychrun...), D shots 3.5, hits 5.5 / 4.5.
 * Used only to find the capped cells of a legacy board.
 */
export const LEGACY_RATE_LIMITS: Record<RateGroup | "C", Partial<Record<SkaterCategory, number>>> = {
  C: { goals: 1.35, assists: 1.65, shots: 6.5, blocks: 2, hits: 5.5, powerplayPoints: 1.3, penaltyMinutes: 4.5 },
  F: { goals: 1.35, assists: 1.65, shots: 6.5, blocks: 1.6, hits: 5.5, powerplayPoints: 1.3, penaltyMinutes: 4.5 },
  D: { goals: 0.18, assists: 1.1, shots: 3.5, blocks: 3.2, hits: 4.5, powerplayPoints: 0.45, penaltyMinutes: 4.5 },
};

/**
 * The published total a legacy cap produced: floor(limit × modelGP) at the
 * model's games, then scaled to the calibrated games by gp calibration.
 */
export function legacyCappedTotal(limit: number, modelGamesPlayed: number, gamesPlayed: number): number {
  const mgp = Math.max(1, modelGamesPlayed);
  const cap = Math.floor(limit * mgp);
  if (gamesPlayed === modelGamesPlayed) return cap;
  return Math.max(0, Math.round(cap * (gamesPlayed / mgp)));
}

/** Stats of a legacy-board projection that sit exactly on the old cap. */
export function legacyCappedCells(p: {
  position: Position;
  primaryPosition?: Position;
  gamesPlayed: number;
  modelGamesPlayed?: number;
  projection: SkaterProjection;
}): SkaterCategory[] {
  const pos = p.primaryPosition ?? p.position;
  const limits = pos === "D" ? LEGACY_RATE_LIMITS.D : pos === "C" ? LEGACY_RATE_LIMITS.C : LEGACY_RATE_LIMITS.F;
  const mgp = p.modelGamesPlayed ?? p.gamesPlayed;
  const out: SkaterCategory[] = [];
  for (const cat of SKATER_CATEGORIES) {
    const lim = limits[cat];
    const v = p.projection[cat];
    if (lim == null || !(v > 0)) continue;
    if (v === legacyCappedTotal(lim, mgp, p.gamesPlayed)) out.push(cat);
  }
  return out;
}

/**
 * How far the board's implied market (published rate − edge) may sit from a
 * reliable rebuild before the cell's market input is deemed grossly
 * corrupted and its edge dropped: max(absolute per-game gap, 20% of the
 * rebuilt market). Below that the cell keeps its edge on the rebuilt market.
 */
export const MARKET_REPAIR_TOLERANCE: Partial<Record<SkaterCategory, number>> = {
  goals: 0.03,
  assists: 0.04,
  shots: 0.25,
  hits: 0.3,
  blocks: 0.2,
  powerplayPoints: 0.03,
  penaltyMinutes: 0.2,
};
export const MARKET_REPAIR_RELATIVE = 0.2;
/** Profile games (seasons of 10+ games) that make a rebuild reliable on their own. */
export const MARKET_REBUILD_MIN_PROFILE_GP = 100;
/** A rebased cell is reported when its market moved by more than this share (and 0.01/game). */
export const MARKET_REBASE_REPORT_RELATIVE = 0.05;

/**
 * Whether a market rebuild may overrule the board. It is exact when the
 * profile seasons are the player's whole history (no older season comes
 * from MoneyPuck, whose non-goal stats are profile averages), and close
 * enough with 100+ profile games (the rebuild then matches the healthy
 * 2026-07-21 board's market to ~0.005 per game, the rounding noise).
 */
export function isReliableRebuild(info: { profileGames: number; olderSeasonGames: number }): boolean {
  return info.profileGames >= MARKET_REBUILD_MIN_PROFILE_GP || info.olderSeasonGames === 0;
}

export interface BootstrapResult {
  /** Raw model per-game rates. */
  rates: SkaterRates;
  /** Raw model edges (missing where the market input was grossly corrupted). */
  edge: Partial<Record<SkaterCategory, number>>;
  /** Cells a legacy cap clipped, restored to market + edge. */
  uncapped: SkaterCategory[];
  /** Cells whose market input was grossly corrupted, reset to the rebuilt market. */
  repaired: SkaterCategory[];
  /** Cells moved onto the rebuilt market (+ edge) by more than rounding. */
  rebased: SkaterCategory[];
}

/**
 * Raw model state of a legacy-board v2 skater, from its published totals,
 * its edge and a rebuild of its synthetic market. The 2026-07-30 dataset
 * carried wrong histories: the board's implied market (rate − edge) misses
 * the rebuild (which reproduces the healthy 2026-07-21 board's market) by
 * 10%+ on ~30% of forward hits and ~15% of blocks cells (Weegar blocks 3.21
 * per game against 2.06 realized, Mark Stone hits 63 per 82 against 41...).
 *  - With a reliable rebuild every cell moves onto the rebuilt market and
 *    keeps its edge (market + edge), except a grossly corrupted cell (gap
 *    beyond MARKET_REPAIR_TOLERANCE): its edge was fit on the same wrong
 *    history, so it gets the rebuilt market and no edge;
 *  - a cell a legacy cap clipped gets market + edge, the model's own rate
 *    before the clamp (its implied market is only a lower bound, so it is
 *    grossly corrupted only when that bound already exceeds the rebuild);
 *  - with an unreliable rebuild other cells keep their published rate.
 */
export function bootstrapModelRates(
  p: {
    position: Position;
    primaryPosition?: Position;
    gamesPlayed: number;
    modelGamesPlayed?: number;
    projection: SkaterProjection;
  },
  edgeIn: Partial<Record<SkaterCategory, number>>,
  market: Partial<Record<SkaterCategory, number>> | null,
  reliable = false,
): BootstrapResult {
  const gp = Math.max(1, p.gamesPlayed);
  const rates = zeroRates();
  const edge: Partial<Record<SkaterCategory, number>> = {};
  for (const cat of SKATER_CATEGORIES) {
    rates[cat] = num(p.projection[cat]) / gp;
    edge[cat] = num(edgeIn[cat]);
  }
  const uncapped: SkaterCategory[] = [];
  const repaired: SkaterCategory[] = [];
  const rebased: SkaterCategory[] = [];
  if (!market) return { rates, edge, uncapped, repaired, rebased };
  const capped = new Set(legacyCappedCells(p));
  for (const cat of SKATER_CATEGORIES) {
    const m = market[cat];
    if (typeof m !== "number" || !Number.isFinite(m)) continue;
    const e = num(edge[cat]);
    const implied = rates[cat] - e;
    const absTol = MARKET_REPAIR_TOLERANCE[cat];
    const tol = absTol == null ? Infinity : Math.max(absTol, MARKET_REPAIR_RELATIVE * m);
    const corrupted =
      reliable &&
      (implied - m > tol || (!capped.has(cat) && m - implied > tol));
    if (corrupted) {
      rates[cat] = Math.max(0, m);
      delete edge[cat];
      repaired.push(cat);
    } else if (capped.has(cat)) {
      rates[cat] = Math.max(0, m + e);
      uncapped.push(cat);
    } else if (reliable) {
      rates[cat] = Math.max(0, m + e);
      if (Math.abs(m - implied) > Math.max(0.01, MARKET_REBASE_REPORT_RELATIVE * m)) rebased.push(cat);
    }
  }
  return { rates, edge, uncapped, repaired, rebased };
}
