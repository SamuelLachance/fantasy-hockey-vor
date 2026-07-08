import type { ModelMetrics, RidgeModel } from "./types";

const LOG_TARGET_EPS = 0.08;

export const LOG_TARGET_STATS = new Set(["blocks"]);

export function usesLogTarget(target: string): boolean {
  return LOG_TARGET_STATS.has(target);
}

export function transformTarget(y: number, logTarget: boolean, eps = LOG_TARGET_EPS): number {
  if (!logTarget) return y;
  return Math.log(Math.max(0, y) + eps);
}

export function inverseTransformTarget(
  y: number,
  logTarget: boolean,
  eps = LOG_TARGET_EPS,
): number {
  if (!logTarget) return y;
  return Math.max(0, Math.exp(y) - eps);
}

export function fitRidge(
  X: number[][],
  y: number[],
  featureNames: string[],
  target: string,
  isGoalie: boolean,
  lambda = 1.5,
  sampleWeights?: number[],
  logTarget = false,
): RidgeModel {
  const n = X.length;
  const p = featureNames.length;
  if (n === 0 || p === 0) {
    throw new Error(`No training samples for ${target}`);
  }

  const eps = LOG_TARGET_EPS;
  const yFit = y.map((v) => transformTarget(v, logTarget, eps));

  const means = Array.from({ length: p }, (_, j) => {
    let sum = 0;
    let wSum = 0;
    for (let i = 0; i < n; i++) {
      const w = sampleWeights?.[i] ?? 1;
      sum += w * X[i][j];
      wSum += w;
    }
    return sum / Math.max(1, wSum);
  });

  const stds = Array.from({ length: p }, (_, j) => {
    let sum = 0;
    let wSum = 0;
    for (let i = 0; i < n; i++) {
      const w = sampleWeights?.[i] ?? 1;
      const d = X[i][j] - means[j];
      sum += w * d * d;
      wSum += w;
    }
    const sd = Math.sqrt(sum / Math.max(1, wSum - 1)) || 1;
    return sd < 1e-8 ? 1 : sd;
  });

  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);
  let yMean = 0;
  let wTotal = 0;
  for (let i = 0; i < n; i++) {
    const w = sampleWeights?.[i] ?? 1;
    yMean += w * yFit[i];
    wTotal += w;
  }
  yMean /= Math.max(1, wTotal);

  for (let i = 0; i < n; i++) {
    const w = sampleWeights?.[i] ?? 1;
    for (let a = 0; a < p; a++) {
      Xty[a] += w * Xs[i][a] * (yFit[i] - yMean);
      for (let b = 0; b < p; b++) {
        XtX[a][b] += w * Xs[i][a] * Xs[i][b];
      }
    }
  }

  for (let j = 0; j < p; j++) XtX[j][j] += lambda;

  const weights = solveSymmetric(XtX, Xty);
  const bias = yMean;

  return {
    target,
    isGoalie,
    featureNames,
    means,
    stds,
    weights,
    bias,
    lambda,
    logTarget,
    logEps: eps,
  };
}

function solveSymmetric(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const div = M[col][col] || 1e-12;
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / div;
      for (let c = col; c <= n; c++) {
        M[row][c] -= factor * M[col][c];
      }
    }
  }

  const x = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row][n];
    for (let col = row + 1; col < n; col++) sum -= M[row][col] * x[col];
    x[row] = sum / (M[row][row] || 1e-12);
  }
  return x;
}

export function predictRidge(model: RidgeModel, features: number[]): number {
  let sum = model.bias;
  for (let j = 0; j < model.weights.length; j++) {
    const scaled = (features[j] - model.means[j]) / model.stds[j];
    sum += model.weights[j] * scaled;
  }
  return inverseTransformTarget(sum, model.logTarget ?? false, model.logEps ?? LOG_TARGET_EPS);
}

const SKATER_LAMBDA_GRID = [5, 10, 25, 50, 100, 200, 400, 600, 800, 1200];

export function selectLambda(
  trainX: number[][],
  trainY: number[],
  valX: number[][],
  valY: number[],
  featureNames: string[],
  target: string,
  isGoalie: boolean,
  trainWeights?: number[],
  valEwma?: number[],
  valLag1?: number[],
  logTarget = false,
): number {
  if (valX.length === 0) return 100;
  let bestLambda = 100;
  let bestR2 = -Infinity;
  for (const lambda of SKATER_LAMBDA_GRID) {
    const model = fitRidge(
      trainX,
      trainY,
      featureNames,
      target,
      isGoalie,
      lambda,
      trainWeights,
      logTarget,
    );
    const mlPreds = valX.map((x) => predictRidge(model, x));
    let r2: number;
    if (valEwma && valLag1) {
      const blend = selectBlendWeights(valY, mlPreds, valEwma, valLag1, target);
      const blended = applyBlendWeights(mlPreds, valEwma, valLag1, blend);
      r2 = evaluateRegression(valY, blended).r2;
    } else {
      r2 = evaluateRegression(valY, mlPreds).r2;
    }
    if (r2 > bestR2) {
      bestR2 = r2;
      bestLambda = lambda;
    }
  }
  return bestLambda;
}

export interface BlendWeights {
  ml: number;
  ewma: number;
  lag1: number;
}

export function applyBlendWeights(
  mlPreds: number[],
  ewmaPreds: number[],
  lag1Preds: number[],
  weights: BlendWeights,
): number[] {
  return mlPreds.map((ml, i) => {
    const ewma = ewmaPreds[i];
    const lag1 = lag1Preds[i];
    let rate = ml * weights.ml;
    if (ewma > 0) rate += ewma * weights.ewma;
    if (lag1 > 0) rate += lag1 * weights.lag1;
    if (ewma <= 0 && lag1 <= 0) rate = ml;
    return Math.max(0, rate);
  });
}

export function selectBlendWeights(
  valY: number[],
  mlPreds: number[],
  ewmaPreds: number[],
  lag1Preds: number[],
  _target = "",
): BlendWeights {
  if (valY.length === 0) return { ml: 0.15, ewma: 0.7, lag1: 0.15 };

  let best: BlendWeights = { ml: 1, ewma: 0, lag1: 0 };
  let bestR2 = -Infinity;

  for (let wm = 0; wm <= 10; wm++) {
    for (let we = 0; we <= 10 - wm; we++) {
      const wl = 10 - wm - we;
      const weights: BlendWeights = { ml: wm / 10, ewma: we / 10, lag1: wl / 10 };
      const preds = applyBlendWeights(mlPreds, ewmaPreds, lag1Preds, weights);
      const r2 = evaluateRegression(valY, preds).r2;
      if (r2 > bestR2) {
        bestR2 = r2;
        best = weights;
      }
    }
  }
  return best;
}

/** @deprecated use selectBlendWeights */
export function selectEwmaBlendWeight(
  valY: number[],
  mlPreds: number[],
  ewmaPreds: number[],
): number {
  const w = selectBlendWeights(valY, mlPreds, ewmaPreds, ewmaPreds);
  return w.ewma;
}

export function blendPredictions(
  mlPreds: number[],
  ewmaPreds: number[],
  ewmaWeight: number,
): number[] {
  return applyBlendWeights(mlPreds, ewmaPreds, ewmaPreds, {
    ml: 1 - ewmaWeight,
    ewma: ewmaWeight,
    lag1: 0,
  });
}

export function evaluateRegression(
  yTrue: number[],
  yPred: number[],
): ModelMetrics {
  const n = yTrue.length;
  let mae = 0;
  let mse = 0;
  let mape = 0;
  let yBar = 0;
  let ssTot = 0;
  let ssRes = 0;

  for (let i = 0; i < n; i++) yBar += yTrue[i];
  yBar /= Math.max(1, n);

  for (let i = 0; i < n; i++) {
    const err = yPred[i] - yTrue[i];
    mae += Math.abs(err);
    mse += err * err;
    if (Math.abs(yTrue[i]) > 0.5) {
      mape += Math.abs(err / yTrue[i]);
    }
    ssRes += err * err;
    ssTot += (yTrue[i] - yBar) ** 2;
  }

  return {
    samples: n,
    mae: mae / Math.max(1, n),
    rmse: Math.sqrt(mse / Math.max(1, n)),
    mape: mape / Math.max(1, n),
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
  };
}
