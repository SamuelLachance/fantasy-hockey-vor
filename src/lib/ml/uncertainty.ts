/**
 * Calibrated projection uncertainty — the "Principle 3" layer.
 *
 * A projection is a mean; shipping it alone pretends the future is knowable to
 * arbitrary precision. It is not. Every projected stat carries irreducible
 * scatter, and this module quantifies it, decomposed into two sources:
 *
 *   1. ALEATORIC (irreducible) — the season-to-season variance a *perfect*
 *      model still cannot remove, because the deciding inputs (linemates,
 *      health, usage, role changes) are unobserved or don't exist yet at
 *      projection time. Estimated from the year-over-year reliability of each
 *      stat: σ_aleatoric = rateSd · √(1 − r²). This is the Bayes floor.
 *
 *   2. MODEL (epistemic) — disagreement among the base signals (marcel, ewma,
 *      lag1, gbdt, ridge, contextual, component) for THIS player. When the
 *      signals concur the projection is well-determined; when they scatter the
 *      model itself is unsure. This is the part more/better information could
 *      shrink.
 *
 * Per-game rate σ = √(σ_aleatoric² + σ_model²), scaled by a per-stat constant
 * calibrated so empirical ±1σ coverage ≈ 68% on the rolling backtest
 * (scripts/backtest.ts --uncertainty prints the coverage + recommended
 * constants; see SIGMA_CALIBRATION / GP_ALEATORIC).
 *
 * Season totals compound rate and games-played uncertainty:
 *   Var(total) = Var(rate · GP) ≈ GP²·Var(rate) + rate²·Var(GP)
 * with Var(GP) from GP-signal dispersion plus an irreducible injury floor
 * (GP_ALEATORIC), likewise calibrated.
 */

/**
 * Year-over-year reliability r per skater stat, measured on 40+ GP season
 * pairs by scripts/backtest.ts ("reliability ceiling" section). Higher r → the
 * stat repeats itself → smaller irreducible floor.
 */
export const STAT_YOY_R: Record<string, number> = {
  goals: 0.798,
  assists: 0.79,
  shots: 0.878,
  blocks: 0.836,
  hits: 0.801,
  powerplayPoints: 0.81,
  penaltyMinutes: 0.78,
  faceoffWins: 0.912,
};

/**
 * Per-stat multiplier on the combined per-game σ so empirical ±1σ coverage
 * ≈ 0.68 on the rolling backtest. 1.0 = raw physical estimate already
 * calibrated. Set from the "recommended σ multiplier" column emitted by
 * `npm run ml:backtest -- --uncertainty` (= 68th percentile of |residual| /
 * raw σ). Re-run and update after any signal/feature change.
 */
export const SIGMA_CALIBRATION: Record<string, number> = {
  goals: 0.79,
  assists: 0.836,
  shots: 0.858,
  blocks: 0.609,
  hits: 0.748,
  powerplayPoints: 0.683,
  penaltyMinutes: 0.792,
  faceoffWins: 0.24,
};

/**
 * Irreducible games-played σ (82-game scale). Injuries are exogenous future
 * events invisible to any prior-state feature, so GP carries a large floor
 * even when the base GP signals agree. Calibrated on the backtest GP coverage
 * (≈ 68th percentile of |GP residual| once signal dispersion is netted out).
 */
export const GP_ALEATORIC = 13.2;

/** Multiplier on GP-signal dispersion, calibrated alongside GP_ALEATORIC. */
export const GP_SIGMA_CALIBRATION = 1;

/**
 * Base signals whose spread defines the epistemic (model) uncertainty. The
 * synthetic-market signal is excluded: it is a Marcel-derived reference, not an
 * independent model, so counting it would double-weight persistence.
 */
export const UNCERTAINTY_RATE_SIGNALS = [
  "gbdt",
  "ridge",
  "marcel",
  "ewma",
  "lag1",
  "contextual",
  "component",
] as const;

export const UNCERTAINTY_GP_SIGNALS = [
  "gbdt",
  "ridge",
  "ewma",
  "lag1",
  "durability",
] as const;

/** Population standard deviation, ignoring non-finite entries. */
export function popStdev(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v));
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/** Irreducible per-game σ for a stat given its cross-sectional σ and reliability. */
export function aleatoricFloor(target: string, rateSd: number): number {
  const r = STAT_YOY_R[target] ?? 0.8;
  return rateSd * Math.sqrt(Math.max(0, 1 - r * r));
}

export interface RateUncertainty {
  /** Combined, calibrated per-game rate σ. */
  sigma: number;
  /** Irreducible component (calibrated). */
  aleatoric: number;
  /** Model-disagreement component (calibrated). */
  modelSpread: number;
}

/**
 * Per-game rate uncertainty for one stat.
 *
 * @param target      stat key
 * @param signalVals  base-signal per-game rates for this player (any order)
 * @param rateSd      population σ of this stat's per-game rate across the
 *                    draftable pool
 * @param calibrate   apply SIGMA_CALIBRATION (false for the raw backtest fit)
 */
export function rateUncertainty(
  target: string,
  signalVals: number[],
  rateSd: number,
  calibrate = true,
): RateUncertainty {
  const aleatoric = aleatoricFloor(target, rateSd);
  const modelSpread = popStdev(signalVals);
  const c = calibrate ? SIGMA_CALIBRATION[target] ?? 1 : 1;
  return {
    sigma: c * Math.hypot(aleatoric, modelSpread),
    aleatoric: c * aleatoric,
    modelSpread: c * modelSpread,
  };
}

/** Games-played σ components: signal dispersion + irreducible injury floor. */
export function gpUncertainty(gpSignalVals: number[]): RateUncertainty {
  const modelSpread = GP_SIGMA_CALIBRATION * popStdev(gpSignalVals);
  const aleatoric = GP_ALEATORIC;
  return {
    sigma: Math.hypot(modelSpread, aleatoric),
    aleatoric,
    modelSpread,
  };
}

/** Games-played σ: signal dispersion combined with the injury floor. */
export function gpSigma(gpSignalVals: number[]): number {
  return gpUncertainty(gpSignalVals).sigma;
}

/**
 * Season-total σ for a stat: propagate independent rate and GP uncertainty
 * through total = rate · GP.  Var(total) ≈ GP²·σ_rate² + rate²·σ_GP².
 */
export function totalStatSigma(
  rate: number,
  rateSigma: number,
  gp: number,
  gamesPlayedSigma: number,
): number {
  const varTotal =
    gp * gp * rateSigma * rateSigma + rate * rate * gamesPlayedSigma * gamesPlayedSigma;
  return Math.sqrt(Math.max(0, varTotal));
}

/**
 * Season-total uncertainty with a correct aleatoric/model split:
 *   σ_ale² = GP²·σ_rate_ale² + rate²·σ_GP_ale²
 *   σ_model² = GP²·σ_rate_model² + rate²·σ_GP_model²
 */
export function totalStatUncertainty(
  rate: number,
  rateU: RateUncertainty,
  gp: number,
  gpU: RateUncertainty,
): RateUncertainty {
  const aleVar =
    gp * gp * rateU.aleatoric * rateU.aleatoric +
    rate * rate * gpU.aleatoric * gpU.aleatoric;
  const modelVar =
    gp * gp * rateU.modelSpread * rateU.modelSpread +
    rate * rate * gpU.modelSpread * gpU.modelSpread;
  return {
    sigma: Math.sqrt(Math.max(0, aleVar + modelVar)),
    aleatoric: Math.sqrt(Math.max(0, aleVar)),
    modelSpread: Math.sqrt(Math.max(0, modelVar)),
  };
}
