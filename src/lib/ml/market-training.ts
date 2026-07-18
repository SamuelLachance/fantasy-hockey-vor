/**
 * Synthetic-market adversarial training helpers (Hubáček-style, fantasy-adapted).
 *
 * "Market" = walk-forward blend of Marcel + EWMA + lag-1 (what a typical
 * manager already prices in). Opportunist models (GBDT/ridge) train on
 * residuals vs that market; meta sample weights focus on disagreement zones
 * and Kelly-inspired draft-capital edges.
 */

import {
  actualRate,
  eligibleHistory,
  gp82,
  type SkaterExample,
} from "./dataset-view";
import {
  ewmaRate,
  lag1Rate,
  marcelRate,
  type MarcelParams,
} from "./marcel";
import type { PlayerSeasonRow } from "./types";

export const MARKET_BLEND = {
  marcel: 0.5,
  ewma: 0.3,
  lag1: 0.2,
} as const;

/** Disagreement threshold in units of within-stat σ. */
const disagreementSigmaEnv = Number(process.env.ML_DISAGREEMENT_SIGMA);
export const DISAGREEMENT_SIGMA =
  Number.isFinite(disagreementSigmaEnv) && disagreementSigmaEnv > 0
    ? disagreementSigmaEnv
    : 0.3;

/** Relative Gaussian noise on whitelisted feature columns during GBDT training. */
export const ADVERSARIAL_STRENGTH = 0.05;

export const MARKET_TRAINING_VERSION = 1;

export interface MarketTrainingConfig {
  version: number;
  blend: typeof MARKET_BLEND;
  disagreementSigma: number;
  adversarialStrength: number;
}

export function defaultMarketTrainingConfig(): MarketTrainingConfig {
  return {
    version: MARKET_TRAINING_VERSION,
    blend: { ...MARKET_BLEND },
    disagreementSigma: DISAGREEMENT_SIGMA,
    adversarialStrength: ADVERSARIAL_STRENGTH,
  };
}

/** Feature names safe to perturb (usage / context / durability — not identity). */
export const ADVERSARIAL_FEATURE_WHITELIST: ReadonlySet<string> = new Set([
  "age",
  "age_sq",
  "height_in",
  "weight_lb",
  "durability",
  "career_gp82",
  "prior_seasons",
  "avail_lag1",
  "avail_lag2",
  "avail_ewma",
  "inj82_lag1",
  "inj82_ewma",
  "spells_lag1",
  "spells_ewma",
  "longest_gap_lag1",
  "chronic_inj",
  "tail82_lag1",
  "head82_lag1",
  "share_lag1",
  "scratch82_lag1",
  "streak_lag1",
  "full_season_lag1",
  "ironman_seasons",
  "late_miss_lag1",
  "late_avail_lag1",
  "rest_risk",
  "wear_lag1",
  "wear_ewma",
  "wear_trend",
  "team_b2b_lag1",
  "age_x_avail",
  "team_gf_pg",
  "team_ga_pg",
  "team_diff_pg",
  "team_rank",
  "team_point_pct",
  "team_elo",
  "team_hits_pg",
  "team_pim_pg",
  "team_blocks_pg",
  "team_pp_share",
  "team_pk_ga60",
  "team_changed",
  "years_on_team",
  "league_gf_pg",
  "season_year",
  "depth_rank",
  "veterans_ahead",
  "opportunity",
]);

function isWhitelistedFeature(name: string): boolean {
  if (ADVERSARIAL_FEATURE_WHITELIST.has(name)) return true;
  // Lag trajectory columns: *_lag1 / *_lag2 / *_ewma / *_trend for rates & gp
  if (/^(gp82|toi|goals|assists|shots|blocks|hits|powerplay|penalty|faceoff|pp_|pk_|cf|ff|xG)/i.test(name)) {
    return true;
  }
  if (/_(lag\d+|ewma|trend|pg)$/.test(name) && !name.startsWith("pos_") && !name.startsWith("draft_")) {
    return true;
  }
  return false;
}

/**
 * Synthetic market rate for a skater example. Uses only history before the
 * target season (walk-forward safe). Falls back to Marcel when EWMA/lag1 missing.
 */
export function marketRate(
  history: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
  target: string,
  marcel: MarcelParams,
  era = 1,
): number {
  const m = marcelRate(marcel, history, targetRow) * era;
  const eRaw = ewmaRate(history, target);
  const lRaw = lag1Rate(history, target);
  const e = Number.isFinite(eRaw) ? (eRaw as number) * era : m;
  const l = Number.isFinite(lRaw) ? (lRaw as number) * era : m;
  return (
    MARKET_BLEND.marcel * m +
    MARKET_BLEND.ewma * e +
    MARKET_BLEND.lag1 * l
  );
}

export function marketRateFromExample(
  ex: SkaterExample,
  target: string,
  marcel: MarcelParams,
  era = 1,
): number {
  return marketRate(ex.history, ex.targetRow, target, marcel, era);
}

/** Synthetic market GP from recent history (EWMA-heavy blend). */
export function marketGp(history: PlayerSeasonRow[]): number {
  const el = eligibleHistory(history);
  const gps = el.slice(-3).map((r) => gp82(r));
  if (gps.length === 0) return 60;
  const lag1 = gps[gps.length - 1];
  const w = [0.5, 0.3, 0.2];
  let ew = 0;
  let ws = 0;
  for (let i = 0; i < gps.length; i++) {
    ew += gps[gps.length - 1 - i] * w[i];
    ws += w[i];
  }
  const ewma = ws > 0 ? ew / ws : lag1;
  // Marcel-like: heavier weight on EWMA than single-season lag
  return Math.min(82, 0.55 * ewma + 0.3 * lag1 + 0.15 * (gps.reduce((a, b) => a + b, 0) / gps.length));
}

export function residualRate(
  ex: SkaterExample,
  target: string,
  marcel: MarcelParams,
  era = 1,
): number {
  return actualRate(ex.actualRow, target) - marketRateFromExample(ex, target, marcel, era);
}

export function residualGp(ex: SkaterExample): number {
  return Math.min(82, gp82(ex.actualRow)) - marketGp(ex.history);
}

/**
 * Co-training weight: upweight disagreement zones, soft-downweight agreement.
 * Returns ~1 when |edge| ≈ disagreementSigma * sd, up to ~4 when far apart,
 * and 0.25 when models agree within the margin.
 */
export function disagreementWeight(
  market: number,
  opportunist: number,
  statSd: number,
  sigma = DISAGREEMENT_SIGMA,
): number {
  const sd = Math.max(1e-6, statSd);
  const z = Math.abs(opportunist - market) / sd;
  if (z < sigma) return 0.25;
  // Smooth ramp from 1 at threshold to ~4 at 4× threshold
  return Math.min(4, 1 + (z - sigma) / Math.max(sigma, 1e-6));
}

/**
 * Kelly-inspired draft-capital weight.
 * marketFvPctile / modelFvPctile in [0,1] (1 = highest fantasy value).
 * Rewards correctly identifying overlays (model > market and actual beat market)
 * and underlays (model < market and actual missed market).
 */
export function kellyFantasyWeight(
  marketFvPctile: number,
  modelFvPctile: number,
  actualBeatMarket: boolean,
  cap = 3,
): number {
  const edge = modelFvPctile - marketFvPctile;
  const aligned = (edge > 0 && actualBeatMarket) || (edge < 0 && !actualBeatMarket);
  // Capital proxy: higher when either market or model puts the player in top half
  const capital = Math.max(marketFvPctile, modelFvPctile);
  const mag = Math.abs(edge) * (0.5 + capital);
  const base = aligned ? 1 + 2 * mag : Math.max(0.35, 1 - mag);
  return Math.min(cap, Math.max(0.25, base));
}

/** Simple percentile ranks for an array of scores (higher = better → pctile near 1). */
export function percentileRanks(scores: number[]): number[] {
  const n = scores.length;
  if (n === 0) return [];
  const idx = scores.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array(n).fill(0.5);
  for (let r = 0; r < n; r++) {
    out[idx[r].i] = n === 1 ? 0.5 : r / (n - 1);
  }
  return out;
}

/**
 * Perturb a feature vector in-place-safe copy. Only whitelisted columns get
 * additive Gaussian noise scaled by |value| * strength (or strength if ~0).
 */
export function perturbFeatureVector(
  vec: number[],
  featureNames: string[],
  strength: number,
  rng: () => number,
): number[] {
  const out = vec.slice();
  for (let j = 0; j < out.length; j++) {
    const name = featureNames[j];
    if (!name || !isWhitelistedFeature(name)) continue;
    const v = out[j];
    if (!Number.isFinite(v)) continue;
    // Box-Muller
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const scale = Math.max(Math.abs(v) * strength, strength * 0.01);
    out[j] = v + z * scale;
  }
  return out;
}

/** Build adversarial column indices from feature names. */
export function adversarialColumnIndices(featureNames: string[]): number[] {
  const idxs: number[] = [];
  for (let j = 0; j < featureNames.length; j++) {
    if (isWhitelistedFeature(featureNames[j])) idxs.push(j);
  }
  return idxs;
}

/** Population std of a list (sample std with n-1 when n>=2). */
export function sampleStd(values: number[]): number {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length < 2) return 1;
  const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
  let ss = 0;
  for (const v of finite) ss += (v - mean) ** 2;
  return Math.sqrt(ss / (finite.length - 1)) || 1;
}
