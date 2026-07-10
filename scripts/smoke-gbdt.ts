/** Synthetic smoke test: GBDT, ridge, and NNLS meta recover known structure. */
import { fitGbdt, predictGbdt, predictGbdtBatch } from "../src/lib/ml/gbdt";
import { fitMetaNnls, fitRidgeV2, predictRidgeV2 } from "../src/lib/ml/stack";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

const rand = rng(42);
const N = 6000;
const P = 12;

// Nonlinear ground truth with interactions and a missing-prone feature.
const X: Float64Array[] = Array.from({ length: P }, () => new Float64Array(N));
const y = new Float64Array(N);
for (let i = 0; i < N; i++) {
  for (let j = 0; j < P; j++) {
    X[j][i] = rand() * 4 - 2;
  }
  if (rand() < 0.25) X[3][i] = NaN; // 25% missing
  const x0 = X[0][i];
  const x1 = X[1][i];
  const x2 = X[2][i];
  const x3 = Number.isFinite(X[3][i]) ? X[3][i] : 0.8; // missing ⇒ acts high
  y[i] =
    2 * Math.sin(x0) +
    x1 * x1 * 0.5 +
    (x2 > 0.5 ? 1.5 : 0) +
    0.7 * x3 +
    0.3 * x0 * x1 +
    (rand() - 0.5) * 0.6;
}

const trainN = 4500;
const trIdx = Array.from({ length: trainN }, (_, i) => i);
const teIdx = Array.from({ length: N - trainN }, (_, i) => trainN + i);

const sub = (idx: number[]): Float64Array[] =>
  X.map((col) => {
    const out = new Float64Array(idx.length);
    idx.forEach((i, k) => (out[k] = col[i]));
    return out;
  });
const subY = (idx: number[]): Float64Array => {
  const out = new Float64Array(idx.length);
  idx.forEach((i, k) => (out[k] = y[i]));
  return out;
};

const Xtr = sub(trIdx.slice(0, 4000));
const ytr = subY(trIdx.slice(0, 4000));
const Xval = sub(trIdx.slice(4000));
const yval = subY(trIdx.slice(4000));
const Xte = sub(teIdx);
const yte = subY(teIdx);

const names = Array.from({ length: P }, (_, j) => `f${j}`);

function r2(yTrue: Float64Array, yPred: Float64Array): number {
  let mean = 0;
  for (let i = 0; i < yTrue.length; i++) mean += yTrue[i];
  mean /= yTrue.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < yTrue.length; i++) {
    ssRes += (yTrue[i] - yPred[i]) ** 2;
    ssTot += (yTrue[i] - mean) ** 2;
  }
  return 1 - ssRes / ssTot;
}

// GBDT
const t0 = Date.now();
const gbdt = fitGbdt(Xtr, ytr, names, "smoke", undefined, {
  nEstimators: 400,
  learningRate: 0.08,
  maxDepth: 4,
  minChildWeight: 5,
  subsample: 0.85,
  colsampleByTree: 0.9,
  earlyStoppingRounds: 30,
}, Xval, yval);
const gbdtPred = predictGbdtBatch(gbdt, Xte);
console.log(
  `gbdt: trees=${gbdt.trees.length} R²=${r2(yte, gbdtPred).toFixed(4)} in ${Date.now() - t0}ms (expect > 0.85)`,
);

// Single-row prediction consistency
const vec = names.map((_, j) => Xte[j][0]);
const single = predictGbdt(gbdt, vec);
console.log(
  `gbdt single-vs-batch consistency: ${Math.abs(single - gbdtPred[0]) < 1e-9 ? "OK" : `FAIL (${single} vs ${gbdtPred[0]})`}`,
);

// Ridge (linear part only — expect worse than GBDT but positive)
const allTrainIdx = Array.from({ length: 4500 }, (_, k) => k);
const XtrAll = sub(trIdx);
const ytrAll = subY(trIdx);
const ridge = fitRidgeV2(XtrAll, names, allTrainIdx, ytrAll, new Float64Array(4500).fill(1), 10);
const ridgePred = new Float64Array(yte.length);
for (let i = 0; i < yte.length; i++) {
  ridgePred[i] = predictRidgeV2(ridge, names.map((_, j) => Xte[j][i]));
}
console.log(`ridge: R²=${r2(yte, ridgePred).toFixed(4)} (expect ~0.4-0.6)`);

// NNLS meta: true y is 0.7×gbdt + 0.3×ridge + small noise — recoverable?
const nMeta = yte.length;
const Xmeta: number[][] = [];
const yMeta: number[] = [];
for (let i = 0; i < nMeta; i++) {
  Xmeta.push([gbdtPred[i], ridgePred[i], rand() * 2 - 1]);
  yMeta.push(yte[i]);
}
const meta = fitMetaNnls(Xmeta, yMeta, new Array(nMeta).fill(1), ["gbdt", "ridge", "noise"]);
console.log(
  `nnls: w=[${meta.weights.map((w) => w.toFixed(3)).join(", ")}] b=${meta.intercept.toFixed(3)} (expect gbdt dominant, noise≈0)`,
);

// Scale invariance: y×80 (GP-like scale) should give same relative weights.
const meta80 = fitMetaNnls(
  Xmeta.map((r) => r.map((v) => v * 80)),
  yMeta.map((v) => v * 80),
  new Array(nMeta).fill(1),
  ["gbdt", "ridge", "noise"],
);
console.log(
  `nnls@80x: w=[${meta80.weights.map((w) => w.toFixed(3)).join(", ")}] b=${meta80.intercept.toFixed(3)} (weights should match above)`,
);
