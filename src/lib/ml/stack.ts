/**
 * Walk-forward stacked ensemble for skater per-game rates and games played.
 *
 * For every season S, base models are trained strictly on target seasons < S,
 * then produce out-of-sample predictions for S. A non-negative least squares
 * meta-learner per target (segmented veteran / low-history) is fit on pooled
 * OOS predictions from seasons before the test season — no information ever
 * flows backward from the season being scored.
 */

import { fitGbdt, predictGbdt, predictGbdtBatch, type GbdtModel, type GbdtOptions } from "./gbdt";
import {
  buildFeatureMatrix,
  buildLeagueContext,
  buildSkaterExamples,
  buildTargetLevels,
  durabilityGpSignal,
  eligibleHistory,
  eraFactor,
  gp82,
  skaterFeatureVector,
  actualRate,
  type LeagueContext,
  type SkaterExample,
  SKATER_V2_FEATURES,
} from "./dataset-view";
import {
  componentGoalsRate,
  ewmaRate,
  fitMarcelParams,
  lag1Rate,
  marcelRate,
  MARCEL_TARGETS,
  type MarcelParams,
} from "./marcel";
import { contextualPerGameRateFromRows } from "./contextual-baseline";
import {
  ADVERSARIAL_STRENGTH,
  DISAGREEMENT_SIGMA,
  adversarialColumnIndices,
  disagreementWeight,
  kellyFantasyWeight,
  marketGp,
  marketRate,
  marketRateFromExample,
  percentileRanks,
  residualGp,
  residualRate,
  sampleStd,
} from "./market-training";
import type { PlayerSeasonRow } from "./types";

export const V2_SKATER_TARGETS = [...MARCEL_TARGETS] as const;
export type V2Target = (typeof V2_SKATER_TARGETS)[number];

export const BASE_SIGNALS = [
  "gbdt",
  "ridge",
  "marcel",
  "ewma",
  "lag1",
  "contextual",
  "component",
  "market",
] as const;
export type BaseSignal = (typeof BASE_SIGNALS)[number];

/** Residual GBDT/ridge + disagreement/Kelly meta (default on). */
export function marketTrainingEnabled(): boolean {
  return process.env.ML_MARKET_TRAINING !== "0";
}

function adversarialEnabled(): boolean {
  return marketTrainingEnabled() && process.env.ML_ADVERSARIAL !== "0";
}

function gbdtAdversarialOpts(): GbdtOptions["adversarial"] | undefined {
  if (!adversarialEnabled()) return undefined;
  return {
    strength: ADVERSARIAL_STRENGTH,
    columnIndices: adversarialColumnIndices(SKATER_V2_FEATURES),
    rowFraction: 0.5,
  };
}

// ---------------------------------------------------------------------------
// Ridge on the shared matrix (NaN-imputed, standardized)

export interface RidgeV2 {
  featureNames: string[];
  means: number[];
  stds: number[];
  /** Column means used for NaN imputation (pre-standardization). */
  imputes: number[];
  weights: number[];
  bias: number;
  lambda: number;
}

function solveSym(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col] || 1e-12;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / div;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = M[r][n];
    for (let c = r + 1; c < n; c++) sum -= M[r][c] * x[c];
    x[r] = sum / (M[r][r] || 1e-12);
  }
  return x;
}

export function fitRidgeV2(
  columns: Float64Array[],
  featureNames: string[],
  rows: number[],
  y: Float64Array,
  weights: Float64Array,
  lambda: number,
): RidgeV2 {
  const p = columns.length;
  const n = rows.length;

  const imputes = new Array(p).fill(0);
  for (let j = 0; j < p; j++) {
    let sum = 0;
    let cnt = 0;
    for (const i of rows) {
      const v = columns[j][i];
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    imputes[j] = cnt > 0 ? sum / cnt : 0;
  }

  const means = new Array(p).fill(0);
  const stds = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    let sum = 0;
    let wSum = 0;
    for (let k = 0; k < n; k++) {
      const i = rows[k];
      const v = Number.isFinite(columns[j][i]) ? columns[j][i] : imputes[j];
      sum += weights[k] * v;
      wSum += weights[k];
    }
    means[j] = wSum > 0 ? sum / wSum : 0;
    let varSum = 0;
    for (let k = 0; k < n; k++) {
      const i = rows[k];
      const v = Number.isFinite(columns[j][i]) ? columns[j][i] : imputes[j];
      varSum += weights[k] * (v - means[j]) ** 2;
    }
    const sd = Math.sqrt(varSum / Math.max(1e-9, wSum));
    stds[j] = sd > 1e-8 ? sd : 1;
  }

  let yMean = 0;
  let wTotal = 0;
  for (let k = 0; k < n; k++) {
    yMean += weights[k] * y[k];
    wTotal += weights[k];
  }
  yMean /= Math.max(1e-9, wTotal);

  const XtX: number[][] = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  const xs = new Array(p).fill(0);
  for (let k = 0; k < n; k++) {
    const i = rows[k];
    const w = weights[k];
    for (let j = 0; j < p; j++) {
      const raw = Number.isFinite(columns[j][i]) ? columns[j][i] : imputes[j];
      xs[j] = (raw - means[j]) / stds[j];
    }
    const dy = y[k] - yMean;
    for (let a = 0; a < p; a++) {
      const xa = xs[a] * w;
      Xty[a] += xa * dy;
      const rowA = XtX[a];
      for (let b = a; b < p; b++) {
        rowA[b] += xa * xs[b];
      }
    }
  }
  for (let a = 0; a < p; a++) {
    for (let b = 0; b < a; b++) XtX[a][b] = XtX[b][a];
    XtX[a][a] += lambda;
  }

  const weightsOut = solveSym(XtX, Xty);
  return {
    featureNames,
    means,
    stds,
    imputes,
    weights: weightsOut,
    bias: yMean,
    lambda,
  };
}

export function predictRidgeV2(model: RidgeV2, features: number[] | Float64Array): number {
  let sum = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    const raw = Number.isFinite(features[j]) ? features[j] : model.imputes[j];
    sum += model.weights[j] * ((raw - model.means[j]) / model.stds[j]);
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Non-negative meta-learner

export interface MetaWeights {
  signals: string[];
  weights: number[];
  intercept: number;
}

/**
 * Non-negative least squares over base signals plus a free intercept.
 * Solved via projected gradient on the precomputed Gram system, with
 * per-column RMS scaling so the step size is scale-free (rates vs GP).
 */
export function fitMetaNnls(
  X: number[][],
  y: number[],
  sampleW: number[],
  signals: readonly string[],
): MetaWeights {
  const n = y.length;
  const p = signals.length;
  if (n < 20) {
    const w = new Array(p).fill(0);
    const mIdx = signals.indexOf("marcel");
    w[mIdx >= 0 ? mIdx : 0] = 1;
    return { signals: [...signals], weights: w, intercept: 0 };
  }

  const wSum = sampleW.reduce((a, b) => a + b, 0) || 1;

  // Column RMS for scaling (last virtual column = intercept, scale 1).
  const rms = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    const w = sampleW[i] / wSum;
    for (let j = 0; j < p; j++) {
      const v = Number.isFinite(X[i][j]) ? X[i][j] : 0;
      rms[j] += w * v * v;
    }
  }
  for (let j = 0; j < p; j++) rms[j] = Math.sqrt(rms[j]) || 1;

  let yScale = 0;
  for (let i = 0; i < n; i++) yScale += (sampleW[i] / wSum) * y[i] * y[i];
  yScale = Math.sqrt(yScale) || 1;

  // Gram system over scaled columns + intercept column.
  const d = p + 1;
  const A: number[][] = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  const xi = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    const w = sampleW[i] / wSum;
    for (let j = 0; j < p; j++) {
      const v = Number.isFinite(X[i][j]) ? X[i][j] : 0;
      xi[j] = v / rms[j];
    }
    xi[p] = 1;
    const ys = y[i] / yScale;
    for (let a = 0; a < d; a++) {
      const wa = xi[a] * w;
      b[a] += wa * ys;
      for (let c = a; c < d; c++) A[a][c] += wa * xi[c];
    }
  }
  for (let a = 0; a < d; a++) {
    for (let c = 0; c < a; c++) A[a][c] = A[c][a];
  }
  const l2 = 1e-5;
  for (let a = 0; a < d; a++) A[a][a] += l2;

  let trace = 0;
  for (let a = 0; a < d; a++) trace += A[a][a];
  const step = 1 / Math.max(1e-9, trace);

  const w = new Array(d).fill(0);
  w[p] = 0;
  for (let iter = 0; iter < 4000; iter++) {
    let maxUpd = 0;
    for (let a = 0; a < d; a++) {
      let grad = -b[a];
      for (let c = 0; c < d; c++) grad += A[a][c] * w[c];
      const upd = step * grad;
      let next = w[a] - upd;
      if (a < p && next < 0) next = 0;
      maxUpd = Math.max(maxUpd, Math.abs(next - w[a]));
      w[a] = next;
    }
    if (maxUpd < 1e-10) break;
  }

  // Undo scaling: pred = Σ w'_j (x_j/rms_j) + b' (in y/yScale units).
  const weights = new Array(p);
  for (let j = 0; j < p; j++) weights[j] = (w[j] * yScale) / rms[j];
  const intercept = w[p] * yScale;

  return { signals: [...signals], weights, intercept };
}

export function applyMeta(meta: MetaWeights, signalValues: number[]): number {
  let out = meta.intercept;
  for (let j = 0; j < meta.weights.length; j++) {
    out += meta.weights[j] * signalValues[j];
  }
  return Math.max(0, out);
}

/** Like applyMeta but allows negative residuals (no floor). */
export function applyMetaRaw(meta: MetaWeights, signalValues: number[]): number {
  let out = meta.intercept;
  for (let j = 0; j < meta.weights.length; j++) {
    out += meta.weights[j] * (Number.isFinite(signalValues[j]) ? signalValues[j] : 0);
  }
  return out;
}

/**
 * Convex meta: non-negative weights that sum to 1, intercept = 0.
 * Projected-gradient fit onto the simplex (not post-hoc renorm of free NNLS).
 */
export function fitMetaConvex(
  X: number[][],
  y: number[],
  sampleW: number[],
  signals: readonly string[],
): MetaWeights {
  const n = y.length;
  const p = signals.length;
  if (n < 20 || p === 0) {
    const w = new Array(p).fill(0);
    const mIdx = signals.indexOf("marcel");
    w[mIdx >= 0 ? mIdx : 0] = 1;
    return { signals: [...signals], weights: w, intercept: 0 };
  }

  const wSum = sampleW.reduce((a, b) => a + b, 0) || 1;
  // Uniform start on the simplex.
  let weights = new Array(p).fill(1 / p);
  const grad = new Array(p).fill(0);

  for (let iter = 0; iter < 400; iter++) {
    grad.fill(0);
    for (let i = 0; i < n; i++) {
      const wi = sampleW[i] / wSum;
      let pred = 0;
      for (let j = 0; j < p; j++) {
        const xij = Number.isFinite(X[i][j]) ? X[i][j] : 0;
        pred += weights[j] * xij;
      }
      const resid = pred - y[i];
      for (let j = 0; j < p; j++) {
        const xij = Number.isFinite(X[i][j]) ? X[i][j] : 0;
        grad[j] += 2 * wi * resid * xij;
      }
    }
    // Diminishing step keeps the walk stable on correlated ~0.9 signals.
    const step = 0.15 / (1 + iter * 0.01);
    const candidate = weights.map((w, j) => w - step * grad[j]);
    weights = projectToSimplex(candidate);
  }

  return { signals: [...signals], weights, intercept: 0 };
}

/** Euclidean projection onto {w ≥ 0, Σw = 1}. */
function projectToSimplex(v: number[]): number[] {
  const n = v.length;
  const u = v.slice().sort((a, b) => b - a);
  let cssv = 0;
  let rho = n - 1;
  for (let i = 0; i < n; i++) {
    cssv += u[i];
    const t = (cssv - 1) / (i + 1);
    if (u[i] - t > 0) rho = i;
  }
  let soft = 0;
  for (let i = 0; i <= rho; i++) soft += u[i];
  const theta = (soft - 1) / (rho + 1);
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * Decision-aware meta: NNLS with Kelly-inspired sample weights already folded
 * into `sampleW` (caller applies kellyFantasyWeight × disagreementWeight).
 * Alias kept for clarity at call sites.
 */
export function fitMetaKelly(
  X: number[][],
  y: number[],
  sampleW: number[],
  signals: readonly string[],
): MetaWeights {
  return fitMetaNnls(X, y, sampleW, signals);
}

// ---------------------------------------------------------------------------
// Base model bundle per boundary

export interface BoundaryModels {
  boundarySeason: number;
  gbdt: Record<string, GbdtModel>;
  ridge: Record<string, RidgeV2>;
  marcel: Record<string, MarcelParams>;
  gbdtGp: GbdtModel;
  ridgeGp: RidgeV2;
}

const GBDT_RATE_OPTS: GbdtOptions = {
  nEstimators: 300,
  learningRate: 0.06,
  maxDepth: 3,
  minChildWeight: 10,
  lambda: 1.0,
  subsample: 0.8,
  colsampleByTree: 0.7,
  earlyStoppingRounds: 20,
};

const GBDT_GP_OPTS: GbdtOptions = {
  nEstimators: 250,
  learningRate: 0.06,
  maxDepth: 3,
  minChildWeight: 15,
  lambda: 2.0,
  subsample: 0.8,
  colsampleByTree: 0.7,
  earlyStoppingRounds: 20,
};

const RIDGE_LAMBDA = 150;

function recencyWeight(seasonId: number, boundarySeason: number): number {
  const yearsBack = (boundarySeason - seasonId) / 10001;
  return Math.exp(-0.12 * Math.max(0, yearsBack));
}

function reliabilityWeight(row: PlayerSeasonRow): number {
  return Math.min(60, row.gamesPlayed) / 60;
}

/** Train all base models for one boundary (train target seasons < boundary). */
export function trainBoundary(
  allExamples: SkaterExample[],
  matrix: { columns: Float64Array[]; featureNames: string[] },
  allRows: PlayerSeasonRow[],
  boundarySeason: number,
  levels?: Record<string, Record<number, number>>,
): BoundaryModels {
  const trainIdx: number[] = [];
  const valIdx: number[] = [];
  let maxTrainSeason = 0;
  for (let i = 0; i < allExamples.length; i++) {
    if (allExamples[i].seasonId < boundarySeason) {
      maxTrainSeason = Math.max(maxTrainSeason, allExamples[i].seasonId);
    }
  }
  for (let i = 0; i < allExamples.length; i++) {
    const s = allExamples[i].seasonId;
    if (s >= boundarySeason) continue;
    if (s === maxTrainSeason) valIdx.push(i);
    else trainIdx.push(i);
  }

  const trainRows = allRows.filter((r) => r.seasonId < boundarySeason);

  const nCols = matrix.columns.length;
  const subColumns = (idx: number[]): Float64Array[] => {
    const cols: Float64Array[] = new Array(nCols);
    for (let j = 0; j < nCols; j++) {
      const col = new Float64Array(idx.length);
      for (let k = 0; k < idx.length; k++) col[k] = matrix.columns[j][idx[k]];
      cols[j] = col;
    }
    return cols;
  };

  const trainCols = subColumns(trainIdx);
  const valCols = subColumns(valIdx);

  const gbdt: Record<string, GbdtModel> = {};
  const ridge: Record<string, RidgeV2> = {};
  const marcel: Record<string, MarcelParams> = {};
  const useMarket = marketTrainingEnabled();
  const advOpts = gbdtAdversarialOpts();
  // Residual targets must be taken against the same era-adjusted market used
  // when signals are reconstructed (computeBaseSignals / inference add the
  // prediction to market(era), so training against market(1) would bake in a
  // per-player bias of market × (era − 1)).
  const eraLevels = levels ?? buildTargetLevels(allRows, V2_SKATER_TARGETS, false);
  const exampleEra = (ex: SkaterExample, target: string): number =>
    eraFactor(eraLevels[target], eligibleHistory(ex.history), ex.seasonId);

  // Fit Marcel first — needed as the synthetic-market anchor for residual targets.
  for (const target of V2_SKATER_TARGETS) {
    marcel[target] = fitMarcelParams(trainRows, target);
  }

  const rateOpts: GbdtOptions = { ...GBDT_RATE_OPTS, adversarial: advOpts };

  for (const target of V2_SKATER_TARGETS) {
    const yTrain = new Float64Array(trainIdx.length);
    const wTrain = new Float64Array(trainIdx.length);
    for (let k = 0; k < trainIdx.length; k++) {
      const ex = allExamples[trainIdx[k]];
      yTrain[k] = useMarket
        ? residualRate(ex, target, marcel[target], exampleEra(ex, target))
        : actualRate(ex.actualRow, target);
      wTrain[k] =
        reliabilityWeight(ex.actualRow) * recencyWeight(ex.seasonId, boundarySeason);
    }
    const yVal = new Float64Array(valIdx.length);
    const wVal = new Float64Array(valIdx.length);
    for (let k = 0; k < valIdx.length; k++) {
      const ex = allExamples[valIdx[k]];
      yVal[k] = useMarket
        ? residualRate(ex, target, marcel[target], exampleEra(ex, target))
        : actualRate(ex.actualRow, target);
      wVal[k] = reliabilityWeight(ex.actualRow);
    }

    gbdt[target] = fitGbdt(
      trainCols,
      yTrain,
      matrix.featureNames,
      target,
      wTrain,
      rateOpts,
      valCols,
      yVal,
      wVal,
    );

    // Ridge trained on train+val (λ fixed — tuning per boundary is noisy and slow).
    const fitIdx = [...trainIdx, ...valIdx];
    const yFit = new Float64Array(fitIdx.length);
    const wFit = new Float64Array(fitIdx.length);
    for (let k = 0; k < fitIdx.length; k++) {
      const ex = allExamples[fitIdx[k]];
      yFit[k] = useMarket
        ? residualRate(ex, target, marcel[target], exampleEra(ex, target))
        : actualRate(ex.actualRow, target);
      wFit[k] =
        reliabilityWeight(ex.actualRow) * recencyWeight(ex.seasonId, boundarySeason);
    }
    ridge[target] = fitRidgeV2(
      matrix.columns,
      matrix.featureNames,
      fitIdx,
      yFit,
      wFit,
      RIDGE_LAMBDA,
    );
  }

  // GP models (82-equivalent target; residual vs synthetic market GP when enabled).
  const yGpTrain = new Float64Array(trainIdx.length);
  const wGpTrain = new Float64Array(trainIdx.length);
  for (let k = 0; k < trainIdx.length; k++) {
    const ex = allExamples[trainIdx[k]];
    yGpTrain[k] = useMarket
      ? residualGp(ex)
      : Math.min(82, gp82(ex.actualRow));
    wGpTrain[k] = recencyWeight(ex.seasonId, boundarySeason);
  }
  const yGpVal = new Float64Array(valIdx.length);
  for (let k = 0; k < valIdx.length; k++) {
    const ex = allExamples[valIdx[k]];
    yGpVal[k] = useMarket
      ? residualGp(ex)
      : Math.min(82, gp82(ex.actualRow));
  }
  const gpOpts: GbdtOptions = { ...GBDT_GP_OPTS, adversarial: advOpts };
  const gbdtGp = fitGbdt(
    trainCols,
    yGpTrain,
    matrix.featureNames,
    "gamesPlayed",
    wGpTrain,
    gpOpts,
    valCols,
    yGpVal,
  );

  const fitIdx = [...trainIdx, ...valIdx];
  const yGpFit = new Float64Array(fitIdx.length);
  const wGpFit = new Float64Array(fitIdx.length);
  for (let k = 0; k < fitIdx.length; k++) {
    const ex = allExamples[fitIdx[k]];
    yGpFit[k] = useMarket
      ? residualGp(ex)
      : Math.min(82, gp82(ex.actualRow));
    wGpFit[k] = recencyWeight(ex.seasonId, boundarySeason);
  }
  const ridgeGp = fitRidgeV2(
    matrix.columns,
    matrix.featureNames,
    fitIdx,
    yGpFit,
    wGpFit,
    RIDGE_LAMBDA,
  );

  return { boundarySeason, gbdt, ridge, marcel, gbdtGp, ridgeGp };
}

// ---------------------------------------------------------------------------
// Base signal computation

export interface BaseSignalSet {
  /** signals[target][signal] = Float64Array over examples. */
  rates: Record<string, Record<BaseSignal, Float64Array>>;
  gp: Record<"gbdt" | "ridge" | "ewma" | "lag1" | "durability", Float64Array>;
}

export function computeBaseSignals(
  models: BoundaryModels,
  examples: SkaterExample[],
  exampleRows: number[],
  matrix: { columns: Float64Array[] },
  levels: Record<string, Record<number, number>>,
): BaseSignalSet {
  const nCols = matrix.columns.length;
  const cols: Float64Array[] = new Array(nCols);
  for (let j = 0; j < nCols; j++) {
    const col = new Float64Array(exampleRows.length);
    for (let k = 0; k < exampleRows.length; k++) col[k] = matrix.columns[j][exampleRows[k]];
    cols[j] = col;
  }

  const rates: Record<string, Record<BaseSignal, Float64Array>> = {};
  const n = exampleRows.length;
  const useMarket = marketTrainingEnabled();

  for (const target of V2_SKATER_TARGETS) {
    const gbdtPred = predictGbdtBatch(models.gbdt[target], cols);
    const set: Record<BaseSignal, Float64Array> = {
      gbdt: gbdtPred,
      ridge: new Float64Array(n),
      marcel: new Float64Array(n),
      ewma: new Float64Array(n),
      lag1: new Float64Array(n),
      contextual: new Float64Array(n),
      component: new Float64Array(n),
      market: new Float64Array(n),
    };

    const vec = new Array(nCols);
    for (let k = 0; k < n; k++) {
      for (let j = 0; j < nCols; j++) vec[j] = cols[j][k];
      const ridgeRes = predictRidgeV2(models.ridge[target], vec);
      const ex = examples[k];
      // Era drift: persistence signals are anchored to the player's history
      // era; rescale them to the target season's expected league level.
      const era = eraFactor(levels[target], eligibleHistory(ex.history), ex.seasonId);
      const m = marcelRate(models.marcel[target], ex.history, ex.targetRow) * era;
      set.marcel[k] = m;
      const e = ewmaRate(ex.history, target);
      set.ewma[k] = Number.isFinite(e) ? e * era : m;
      const l = lag1Rate(ex.history, target);
      set.lag1[k] = Number.isFinite(l) ? l * era : m;
      const c = contextualPerGameRateFromRows(ex.history, ex.targetRow, target);
      set.contextual[k] = Number.isFinite(c) ? c * era : m;
      if (target === "goals") {
        const comp = componentGoalsRate(models.marcel.shots, ex.history, ex.targetRow);
        // Scale shot volume by the shots-era factor; finishing rate stays in
        // history-era units (componentGoalsRate = marcelShots × sh%).
        const shotsEra = eraFactor(levels.shots, eligibleHistory(ex.history), ex.seasonId);
        set.component[k] = Number.isFinite(comp) ? comp * shotsEra : m;
      } else {
        set.component[k] = m;
      }

      const mkt = useMarket
        ? marketRateFromExample(ex, target, models.marcel[target], era)
        : m;
      set.market[k] = mkt;

      if (useMarket) {
        // Keep signed residuals intact for the meta; clamp only published rates.
        set.gbdt[k] = mkt + set.gbdt[k];
        set.ridge[k] = mkt + ridgeRes;
      } else {
        set.gbdt[k] = Math.max(0, set.gbdt[k]);
        set.ridge[k] = Math.max(0, ridgeRes);
      }
    }
    rates[target] = set;
  }

  // GP signals
  const gbdtGp = predictGbdtBatch(models.gbdtGp, cols);
  const gp: BaseSignalSet["gp"] = {
    gbdt: gbdtGp,
    ridge: new Float64Array(n),
    ewma: new Float64Array(n),
    lag1: new Float64Array(n),
    durability: new Float64Array(n),
  };
  const vec = new Array(nCols);
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < nCols; j++) vec[j] = cols[j][k];
    const ridgeRes = predictRidgeV2(models.ridgeGp, vec);
    const ex = examples[k];
    const el = eligibleHistory(ex.history);
    const gps = el.slice(-3).map((r) => gp82(r));
    const lag1 = gps.length > 0 ? gps[gps.length - 1] : 60;
    const w = [0.5, 0.3, 0.2];
    let ew = 0;
    let ws = 0;
    for (let i = 0; i < gps.length; i++) {
      ew += gps[gps.length - 1 - i] * w[i];
      ws += w[i];
    }
    const ewma = ws > 0 ? ew / ws : lag1;
    gp.lag1[k] = Math.min(82, lag1);
    gp.ewma[k] = Math.min(82, ewma);
    const mean = gps.length > 0 ? gps.reduce((a, b) => a + b, 0) / gps.length : 60;
    const cv =
      gps.length > 1 && mean > 0
        ? Math.sqrt(gps.reduce((s, g) => s + (g - mean) ** 2, 0) / gps.length) / mean
        : 0.15;
    const dur = Math.max(0.5, Math.min(1, 1 - cv * 0.5));
    // Game-log availability signal when logs exist; CV heuristic otherwise.
    const availSig = durabilityGpSignal(ex.history);
    gp.durability[k] = Number.isFinite(availSig)
      ? availSig
      : Math.min(82, ewma * (0.88 + 0.14 * dur));

    const mktGp = useMarket ? marketGp(ex.history) : ewma;
    if (useMarket) {
      // Preserve signed GP residuals for meta blending; clamp at prediction.
      gp.gbdt[k] = mktGp + gp.gbdt[k];
      gp.ridge[k] = mktGp + ridgeRes;
    } else {
      gp.gbdt[k] = Math.max(10, Math.min(82, gp.gbdt[k]));
      gp.ridge[k] = Math.max(10, Math.min(82, ridgeRes));
    }
  }

  return { rates, gp };
}

// ---------------------------------------------------------------------------
// Walk-forward driver

export interface SeasonPredictions {
  seasonId: number;
  examples: SkaterExample[];
  exampleRows: number[];
  signals: BaseSignalSet;
}

export interface WalkForwardOutput {
  seasons: SeasonPredictions[];
  league: LeagueContext;
  examples: SkaterExample[];
  matrix: ReturnType<typeof buildFeatureMatrix>;
  levels: Record<string, Record<number, number>>;
}

export function runWalkForward(
  rows: PlayerSeasonRow[],
  evalSeasons: number[],
  onProgress?: (msg: string) => void,
): WalkForwardOutput {
  const league = buildLeagueContext(rows);
  const examples = buildSkaterExamples(rows);
  const levels = buildTargetLevels(rows, V2_SKATER_TARGETS, false);
  onProgress?.(
    `walk-forward: ${examples.length} skater examples, ${SKATER_V2_FEATURES.length} features`,
  );
  const matrix = buildFeatureMatrix(examples, league);

  const rowsBySeason = new Map<number, number[]>();
  for (let i = 0; i < examples.length; i++) {
    const list = rowsBySeason.get(examples[i].seasonId) ?? [];
    list.push(i);
    rowsBySeason.set(examples[i].seasonId, list);
  }

  const seasons: SeasonPredictions[] = [];
  for (const seasonId of evalSeasons) {
    const exampleRows = rowsBySeason.get(seasonId) ?? [];
    if (exampleRows.length === 0) continue;
    const t0 = Date.now();
    const models = trainBoundary(examples, matrix, rows, seasonId, levels);
    const sigs = computeBaseSignals(
      models,
      exampleRows.map((i) => examples[i]),
      exampleRows,
      matrix,
      levels,
    );
    onProgress?.(
      `  boundary ${seasonId}: ${exampleRows.length} test rows in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
    seasons.push({
      seasonId,
      examples: exampleRows.map((i) => examples[i]),
      exampleRows,
      signals: sigs,
    });
  }

  return { seasons, league, examples, matrix, levels };
}

// ---------------------------------------------------------------------------
// Meta fitting from pooled walk-forward seasons

/** Meta segments: veteran/young × forward/defense. Elite offensive D have
 * different signal reliabilities than forwards; pooled weights bias them. */
export type MetaSegment = "vetF" | "vetD" | "youngF" | "youngD";

export interface StackedMeta {
  target: string;
  segments: Record<MetaSegment, MetaWeights>;
}

export interface GpMeta {
  vet: MetaWeights;
  young: MetaWeights;
}

const GP_SIGNALS: BaseSignal[] = ["gbdt", "ridge", "ewma", "lag1", "contextual"];
// For GP, "contextual" slot carries the durability signal.

function isYoungExample(ex: SkaterExample): boolean {
  return eligibleHistory(ex.history).length <= 2;
}

export function metaSegmentOf(young: boolean, isDefense: boolean): MetaSegment {
  if (young) return isDefense ? "youngD" : "youngF";
  return isDefense ? "vetD" : "vetF";
}

export function fitStackedMetas(
  pool: SeasonPredictions[],
  testSeason: number,
  disagreementSigma = DISAGREEMENT_SIGMA,
): { rateMetas: Record<string, StackedMeta>; gpMeta: GpMeta } {
  const rateMetas: Record<string, StackedMeta> = {};
  const useMarket = marketTrainingEnabled();

  for (const target of V2_SKATER_TARGETS) {
    const X: Record<MetaSegment, number[][]> = { vetF: [], vetD: [], youngF: [], youngD: [] };
    const Y: Record<MetaSegment, number[]> = { vetF: [], vetD: [], youngF: [], youngD: [] };
    const W: Record<MetaSegment, number[]> = { vetF: [], vetD: [], youngF: [], youngD: [] };

    // Collect raw rows first so we can compute Kelly percentiles within each season.
    type RawRow = {
      seg: MetaSegment;
      x: number[];
      y: number;
      relW: number;
      market: number;
      opportunist: number;
      actual: number;
    };
    const seasonBuckets: RawRow[][] = [];

    for (const season of pool) {
      const recency = Math.exp(-0.15 * ((testSeason - season.seasonId) / 10001));
      const sig = season.signals.rates[target];
      const bucket: RawRow[] = [];
      for (let k = 0; k < season.examples.length; k++) {
        const ex = season.examples[k];
        const mkt = sig.market?.[k] ?? sig.marcel[k];
        const actual = actualRate(ex.actualRow, target);
        const opportunist = 0.5 * sig.gbdt[k] + 0.5 * sig.ridge[k];
        const xAbs = [
          sig.gbdt[k],
          sig.ridge[k],
          sig.marcel[k],
          sig.ewma[k],
          sig.lag1[k],
          sig.contextual[k],
          sig.component[k],
          mkt,
        ];
        // Residual meta: X is signal − market for deep/persistence; market absolute last.
        const x = useMarket
          ? [
              sig.gbdt[k] - mkt,
              sig.ridge[k] - mkt,
              sig.marcel[k] - mkt,
              sig.ewma[k] - mkt,
              sig.lag1[k] - mkt,
              sig.contextual[k] - mkt,
              sig.component[k] - mkt,
              mkt,
            ]
          : xAbs;
        const y = useMarket ? actual - mkt : actual;
        bucket.push({
          seg: metaSegmentOf(isYoungExample(ex), ex.targetRow.position === "D"),
          x,
          y,
          relW: (Math.min(60, ex.actualRow.gamesPlayed) / 60) * recency,
          market: mkt,
          opportunist,
          actual,
        });
      }
      seasonBuckets.push(bucket);
    }

    // League σ of actual rates across the pool (for disagreement z-score).
    const allActual = seasonBuckets.flatMap((b) => b.map((r) => r.actual));
    const statSd = sampleStd(allActual);

    for (const bucket of seasonBuckets) {
      const marketScores = bucket.map((r) => r.market);
      const modelScores = bucket.map((r) => r.opportunist);
      const marketPct = percentileRanks(marketScores);
      const modelPct = percentileRanks(modelScores);
      for (let i = 0; i < bucket.length; i++) {
        const r = bucket[i];
        let w = r.relW;
        if (useMarket) {
          const wD = disagreementWeight(
            r.market,
            r.opportunist,
            statSd,
            disagreementSigma,
          );
          const wK = kellyFantasyWeight(marketPct[i], modelPct[i]);
          w *= wD * wK;
        }
        X[r.seg].push(r.x);
        Y[r.seg].push(r.y);
        W[r.seg].push(w);
      }
    }

    const fitSeg = useMarket ? fitMetaKelly : fitMetaNnls;
    rateMetas[target] = {
      target,
      segments: {
        vetF: fitSeg(X.vetF, Y.vetF, W.vetF, [...BASE_SIGNALS]),
        vetD: fitSeg(X.vetD, Y.vetD, W.vetD, [...BASE_SIGNALS]),
        youngF: fitSeg(X.youngF, Y.youngF, W.youngF, [...BASE_SIGNALS]),
        youngD: fitSeg(X.youngD, Y.youngD, W.youngD, [...BASE_SIGNALS]),
      },
    };
  }

  // GP meta
  const Xv: number[][] = [];
  const yv: number[] = [];
  const wv: number[] = [];
  const Xy: number[][] = [];
  const yy: number[] = [];
  const wy: number[] = [];
  for (const season of pool) {
    const recency = Math.exp(-0.15 * ((testSeason - season.seasonId) / 10001));
    const gp = season.signals.gp;
    for (let k = 0; k < season.examples.length; k++) {
      const ex = season.examples[k];
      const row = [gp.gbdt[k], gp.ridge[k], gp.ewma[k], gp.lag1[k], gp.durability[k]];
      const y = Math.min(82, gp82(ex.actualRow));
      const mkt = marketGp(ex.history);
      const opportunist = 0.5 * gp.gbdt[k] + 0.5 * gp.ridge[k];
      let w = recency;
      if (useMarket) {
        w *= disagreementWeight(mkt, opportunist, 12, disagreementSigma);
      }
      if (isYoungExample(ex)) {
        Xy.push(row);
        yy.push(y);
        wy.push(w);
      } else {
        Xv.push(row);
        yv.push(y);
        wv.push(w);
      }
    }
  }

  return {
    rateMetas,
    gpMeta: {
      vet: fitMetaNnls(Xv, yv, wv, GP_SIGNALS),
      young: fitMetaNnls(Xy, yy, wy, GP_SIGNALS),
    },
  };
}

export function metaRatePrediction(
  meta: StackedMeta,
  sig: Record<BaseSignal, Float64Array>,
  k: number,
  young: boolean,
  isDefense: boolean,
  residualModels?: boolean,
): number {
  const seg = meta.segments[metaSegmentOf(young, isDefense)];
  const mkt = sig.market?.[k] ?? sig.marcel[k];
  // Residual-vs-absolute application must match the space the weights were
  // FIT in. Inference passes the bundle's marketTraining flag; only training
  // (same process as the fit) may fall back to the env toggle.
  const residualize =
    Boolean(sig.market) &&
    seg.signals.includes("market") &&
    (residualModels ?? marketTrainingEnabled());
  if (residualize) {
    const row = [
      sig.gbdt[k] - mkt,
      sig.ridge[k] - mkt,
      sig.marcel[k] - mkt,
      sig.ewma[k] - mkt,
      sig.lag1[k] - mkt,
      sig.contextual[k] - mkt,
      sig.component[k] - mkt,
      mkt,
    ];
    return Math.max(0, mkt + applyMetaRaw(seg, row));
  }
  // Legacy metas (no market signal): first 7 weights only.
  if (!seg.signals.includes("market")) {
    const row = [
      sig.gbdt[k],
      sig.ridge[k],
      sig.marcel[k],
      sig.ewma[k],
      sig.lag1[k],
      sig.contextual[k],
      sig.component[k],
    ];
    return applyMeta(seg, row);
  }
  const row = [
    sig.gbdt[k],
    sig.ridge[k],
    sig.marcel[k],
    sig.ewma[k],
    sig.lag1[k],
    sig.contextual[k],
    sig.component[k],
    mkt,
  ];
  return applyMeta(seg, row);
}

// ---------------------------------------------------------------------------
// Post-hoc rate calibration (Principle 2: reduce systematic misspecification).
//
// At the reliability ceiling the ranking is saturated, so the only recoverable
// error is systematic: the blended rate can be mildly over/under-dispersed
// (regression-to-mean) and is positively biased at the low end by the max(0,·)
// floor. A strictly-monotone affine map actual ≈ a + b·pred, shrunk toward
// identity, removes that without ever reordering players (slope ≥ 0), so it
// cannot cost ranking accuracy and cannot overfit in the shrinkage limit.

export interface RateCalibrator {
  slope: number;
  intercept: number;
}

export function applyRateCalibrator(
  cal: RateCalibrator | undefined,
  pred: number,
): number {
  if (!cal) return pred;
  return Math.max(0, cal.intercept + cal.slope * pred);
}

/**
 * Weighted LS of actual ~ a + b·pred, shrunk toward identity by n_eff.
 * `K` = shrinkage strength (effective samples); larger → closer to identity.
 * Skater rates use a large K (already well-scaled); noise-dominated goalie
 * rates use a smaller K so the calibrator can actually correct the scale.
 */
export function fitAffineCalibrator(
  pred: number[],
  actual: number[],
  w: number[],
  K = 400,
): RateCalibrator {
  let sw = 0;
  let sw2 = 0;
  let swx = 0;
  let swy = 0;
  let swxx = 0;
  let swxy = 0;
  for (let i = 0; i < pred.length; i++) {
    const p = pred[i];
    const a = actual[i];
    const wi = w[i];
    if (!Number.isFinite(p) || !Number.isFinite(a) || !(wi > 0)) continue;
    sw += wi;
    sw2 += wi * wi;
    swx += wi * p;
    swy += wi * a;
    swxx += wi * p * p;
    swxy += wi * p * a;
  }
  if (sw <= 0) return { slope: 1, intercept: 0 };
  const denom = sw * swxx - swx * swx;
  let b = denom > 1e-9 ? (sw * swxy - swx * swy) / denom : 1;
  let a = (swy - b * swx) / sw;
  const nEff = (sw * sw) / Math.max(1e-9, sw2); // Kish effective sample size
  const lambda = nEff / (nEff + K);
  b = 1 + lambda * (b - 1);
  a = lambda * a;
  b = Math.max(0.5, Math.min(1.5, b)); // monotone + guard pathological slopes
  return { slope: b, intercept: a };
}

/**
 * Fit one affine calibrator per target on strictly out-of-sample (pred, actual)
 * pairs. Leakage-free: an expanding-window meta walk-forward INSIDE the pool
 * (meta for season s fit only on pool seasons < s), and the fit predictions are
 * UNCALIBRATED. `testSeason` is never in `pool`, so it is never touched.
 */
export function fitRateCalibrators(
  pool: SeasonPredictions[],
  testSeason: number,
  disagreementSigma = DISAGREEMENT_SIGMA,
): Record<string, RateCalibrator> {
  const ordered = [...pool].sort((x, y) => x.seasonId - y.seasonId);
  const acc: Record<string, { p: number[]; a: number[]; w: number[] }> = {};
  for (const t of V2_SKATER_TARGETS) acc[t] = { p: [], a: [], w: [] };
  const residual = marketTrainingEnabled();
  for (let si = 1; si < ordered.length; si++) {
    const past = ordered.slice(0, si);
    const cur = ordered[si];
    const { rateMetas } = fitStackedMetas(past, cur.seasonId, disagreementSigma);
    for (const t of V2_SKATER_TARGETS) {
      const sig = cur.signals.rates[t];
      const meta = rateMetas[t];
      for (let k = 0; k < cur.examples.length; k++) {
        const ex = cur.examples[k];
        const young = eligibleHistory(ex.history).length <= 2;
        const isD = ex.targetRow.position === "D";
        const pred = metaRatePrediction(meta, sig, k, young, isD, residual);
        acc[t].p.push(pred);
        acc[t].a.push(actualRate(ex.actualRow, t));
        acc[t].w.push(Math.min(60, ex.actualRow.gamesPlayed) / 60);
      }
    }
  }
  const out: Record<string, RateCalibrator> = {};
  for (const t of V2_SKATER_TARGETS) {
    out[t] = fitAffineCalibrator(acc[t].p, acc[t].a, acc[t].w);
  }
  return out;
}

export function metaGpPrediction(
  meta: GpMeta,
  gp: BaseSignalSet["gp"],
  k: number,
  young: boolean,
): number {
  const row = [gp.gbdt[k], gp.ridge[k], gp.ewma[k], gp.lag1[k], gp.durability[k]];
  return Math.max(10, Math.min(82, applyMeta(young ? meta.young : meta.vet, row)));
}

/** Build residual-style signal row for a single-player absolute rate map. */
export function rateSignalRow(
  rates: Record<BaseSignal, number>,
  residualize: boolean,
): number[] {
  const mkt = rates.market ?? rates.marcel;
  if (residualize) {
    return [
      rates.gbdt - mkt,
      rates.ridge - mkt,
      rates.marcel - mkt,
      rates.ewma - mkt,
      rates.lag1 - mkt,
      rates.contextual - mkt,
      rates.component - mkt,
      mkt,
    ];
  }
  return [
    rates.gbdt,
    rates.ridge,
    rates.marcel,
    rates.ewma,
    rates.lag1,
    rates.contextual,
    rates.component,
    mkt,
  ];
}

// ---------------------------------------------------------------------------
// Single-row inference (used by production predict path)

export interface V2InferenceInput {
  history: PlayerSeasonRow[];
  targetRow: PlayerSeasonRow;
  league: LeagueContext;
  /** Per-target league levels for era normalization. */
  levels: Record<string, Record<number, number>>;
  /** True when GBDT/ridge were trained on market residuals (bundle.marketTraining). */
  residualModels?: boolean;
}

export function inferBaseSignalsForPlayer(
  models: BoundaryModels,
  input: V2InferenceInput,
  contextualRates: Record<string, number>,
): { rates: Record<string, Record<BaseSignal, number>>; gp: Record<string, number> } {
  const vec = skaterFeatureVector(input.history, input.targetRow, input.league);
  const rates: Record<string, Record<BaseSignal, number>> = {};
  const eligible = eligibleHistory(input.history);
  const useMarket = input.residualModels ?? marketTrainingEnabled();

  for (const target of V2_SKATER_TARGETS) {
    const era = eraFactor(input.levels[target], eligible, input.targetRow.seasonId);
    const m = marcelRate(models.marcel[target], input.history, input.targetRow) * era;
    const e = ewmaRate(input.history, target);
    const l = lag1Rate(input.history, target);
    const c = contextualRates[target];
    let comp = m;
    if (target === "goals") {
      const cg = componentGoalsRate(models.marcel.shots, input.history, input.targetRow);
      if (Number.isFinite(cg)) {
        const shotsEra = eraFactor(input.levels.shots, eligible, input.targetRow.seasonId);
        comp = cg * shotsEra;
      }
    }
    const mkt = useMarket
      ? marketRate(input.history, input.targetRow, target, models.marcel[target], era)
      : m;
    const gbdtRes = predictGbdt(models.gbdt[target], vec);
    const ridgeRes = predictRidgeV2(models.ridge[target], vec);
    rates[target] = {
      gbdt: useMarket ? mkt + gbdtRes : Math.max(0, gbdtRes),
      ridge: useMarket ? mkt + ridgeRes : Math.max(0, ridgeRes),
      marcel: m,
      ewma: Number.isFinite(e) ? e * era : m,
      lag1: Number.isFinite(l) ? l * era : m,
      contextual: Number.isFinite(c) ? c * era : m,
      component: comp,
      market: mkt,
    };
  }

  const el = eligibleHistory(input.history);
  const gps = el.slice(-3).map((r) => gp82(r));
  const lag1 = gps.length > 0 ? Math.min(82, gps[gps.length - 1]) : 60;
  const w = [0.5, 0.3, 0.2];
  let ew = 0;
  let ws = 0;
  for (let i = 0; i < gps.length; i++) {
    ew += gps[gps.length - 1 - i] * w[i];
    ws += w[i];
  }
  const ewma = ws > 0 ? Math.min(82, ew / ws) : lag1;
  const mean = gps.length > 0 ? gps.reduce((a, b) => a + b, 0) / gps.length : 60;
  const cv =
    gps.length > 1 && mean > 0
      ? Math.sqrt(gps.reduce((s, g) => s + (g - mean) ** 2, 0) / gps.length) / mean
      : 0.15;
  const dur = Math.max(0.5, Math.min(1, 1 - cv * 0.5));
  const availSig = durabilityGpSignal(input.history);
  const mktGp = useMarket ? marketGp(input.history) : ewma;
  const gbdtGpRes = predictGbdt(models.gbdtGp, vec);
  const ridgeGpRes = predictRidgeV2(models.ridgeGp, vec);

  const gp = {
    gbdt: useMarket ? mktGp + gbdtGpRes : Math.max(10, Math.min(82, gbdtGpRes)),
    ridge: useMarket ? mktGp + ridgeGpRes : Math.max(10, Math.min(82, ridgeGpRes)),
    ewma,
    lag1,
    durability: Number.isFinite(availSig)
      ? availSig
      : Math.min(82, ewma * (0.88 + 0.14 * dur)),
  };

  return { rates, gp };
}
