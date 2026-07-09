import type { GbmModel, ModelMetrics } from "./types";

export interface GbmFitOptions {
  nEstimators?: number;
  learningRate?: number;
  minSamplesLeaf?: number;
}

interface Stump {
  featureIndex: number;
  threshold: number;
  leftValue: number;
  rightValue: number;
}

function mean(values: number[], weights?: number[]): number {
  let sum = 0;
  let wSum = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights?.[i] ?? 1;
    sum += values[i] * w;
    wSum += w;
  }
  return wSum > 0 ? sum / wSum : 0;
}

function bestStump(
  X: number[][],
  residuals: number[],
  weights: number[] | undefined,
  usedFeatures: Set<number>,
): Stump | null {
  const n = X.length;
  const p = X[0]?.length ?? 0;
  if (n < 4 || p === 0) return null;

  let best: Stump | null = null;
  let bestLoss = Infinity;

  for (let j = 0; j < p; j++) {
    if (usedFeatures.has(j)) continue;
    const values = X.map((row) => row[j]);
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const thresholds: number[] = [];
    if (sorted.length <= 16) {
      for (let k = 0; k < sorted.length - 1; k++) {
        thresholds.push((sorted[k] + sorted[k + 1]) / 2);
      }
      if (thresholds.length === 0) thresholds.push(sorted[0]);
    } else {
      for (let q = 1; q < 16; q++) {
        const idx = Math.floor((q / 16) * (sorted.length - 1));
        thresholds.push((sorted[idx] + sorted[idx + 1]) / 2);
      }
    }

    for (const threshold of thresholds) {
      let leftSum = 0;
      let leftW = 0;
      let rightSum = 0;
      let rightW = 0;
      for (let i = 0; i < n; i++) {
        const w = weights?.[i] ?? 1;
        if (X[i][j] <= threshold) {
          leftSum += residuals[i] * w;
          leftW += w;
        } else {
          rightSum += residuals[i] * w;
          rightW += w;
        }
      }
      const leftValue = leftW > 0 ? leftSum / leftW : 0;
      const rightValue = rightW > 0 ? rightSum / rightW : 0;

      let loss = 0;
      for (let i = 0; i < n; i++) {
        const w = weights?.[i] ?? 1;
        const pred = X[i][j] <= threshold ? leftValue : rightValue;
        const err = residuals[i] - pred;
        loss += w * err * err;
      }
      if (loss < bestLoss) {
        bestLoss = loss;
        best = { featureIndex: j, threshold, leftValue, rightValue };
      }
    }
  }
  return best;
}

export function fitGbm(
  X: number[][],
  y: number[],
  featureNames: string[],
  target: string,
  isGoalie: boolean,
  sampleWeights?: number[],
  options: GbmFitOptions = {},
): GbmModel {
  const nEstimators = options.nEstimators ?? 80;
  const learningRate = options.learningRate ?? 0.08;
  const n = X.length;
  if (n === 0) throw new Error(`No samples for GBM ${target}`);

  let prediction = mean(y, sampleWeights);
  const trees: Stump[] = [];
  const residuals = y.map((v) => v - prediction);

  for (let t = 0; t < nEstimators; t++) {
    const stump = bestStump(X, residuals, sampleWeights, new Set());
    if (!stump) break;
    trees.push(stump);
    for (let i = 0; i < n; i++) {
      const add =
        (X[i][stump.featureIndex] <= stump.threshold
          ? stump.leftValue
          : stump.rightValue) * learningRate;
      prediction += add;
      residuals[i] = y[i] - prediction;
    }
  }

  return {
    modelType: "gbm",
    target,
    isGoalie,
    featureNames,
    initBias: mean(y, sampleWeights),
    learningRate,
    trees,
  };
}

export function predictGbm(model: GbmModel, features: number[]): number {
  let pred = model.initBias;
  for (const tree of model.trees) {
    const branch =
      features[tree.featureIndex] <= tree.threshold
        ? tree.leftValue
        : tree.rightValue;
    pred += branch * model.learningRate;
  }
  return pred;
}

export function evaluateGbmRegression(
  yTrue: number[],
  yPred: number[],
): ModelMetrics {
  const n = yTrue.length;
  let mae = 0;
  let mse = 0;
  let yBar = 0;
  for (let i = 0; i < n; i++) yBar += yTrue[i];
  yBar /= Math.max(1, n);
  let ssTot = 0;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    mae += Math.abs(yTrue[i] - yPred[i]);
    mse += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - yBar) ** 2;
    ssRes += (yTrue[i] - yPred[i]) ** 2;
  }
  return {
    samples: n,
    mae: mae / Math.max(1, n),
    rmse: Math.sqrt(mse / Math.max(1, n)),
    mape: 0,
    r2: ssTot > 0 ? 1 - ssRes / ssTot : 0,
  };
}
