import type { ModelMetrics, RidgeModel } from "./types";

export function fitRidge(
  X: number[][],
  y: number[],
  featureNames: string[],
  target: string,
  isGoalie: boolean,
  lambda = 1.5,
): RidgeModel {
  const n = X.length;
  const p = featureNames.length;
  if (n === 0 || p === 0) {
    throw new Error(`No training samples for ${target}`);
  }

  const means = Array.from({ length: p }, (_, j) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += X[i][j];
    return sum / n;
  });

  const stds = Array.from({ length: p }, (_, j) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = X[i][j] - means[j];
      sum += d * d;
    }
    const sd = Math.sqrt(sum / Math.max(1, n - 1)) || 1;
    return sd < 1e-8 ? 1 : sd;
  });

  const Xs = X.map((row) => row.map((v, j) => (v - means[j]) / stds[j]));
  const XtX = Array.from({ length: p }, () => Array(p).fill(0));
  const Xty = Array(p).fill(0);
  let yMean = 0;
  for (let i = 0; i < n; i++) yMean += y[i];
  yMean /= n;

  for (let i = 0; i < n; i++) {
    for (let a = 0; a < p; a++) {
      Xty[a] += Xs[i][a] * (y[i] - yMean);
      for (let b = 0; b < p; b++) {
        XtX[a][b] += Xs[i][a] * Xs[i][b];
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
  return sum;
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
