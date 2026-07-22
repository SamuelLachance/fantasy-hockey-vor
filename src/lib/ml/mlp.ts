/**
 * Small feedforward MLP for tabular regression (pure TypeScript).
 *
 * Sized for goalie walk-forward (~1k rows × ~70 features): shallow net,
 * Adam + early stopping + L2, NaN impute + standardize. Serializes to JSON
 * for the v2 bundle — no native / WASM deps.
 */

export interface MlpLayer {
  /** rows = outDim, cols = inDim */
  weights: number[][];
  bias: number[];
}

export interface MlpModel {
  modelType: "mlp";
  target: string;
  featureNames: string[];
  /** Column means for NaN imputation (pre-standardization). */
  imputes: number[];
  means: number[];
  stds: number[];
  layers: MlpLayer[];
  bestEpoch: number;
  trainLoss: number;
  valLoss: number;
}

export interface MlpOptions {
  hidden?: number[];
  learningRate?: number;
  l2?: number;
  batchSize?: number;
  maxEpochs?: number;
  earlyStoppingRounds?: number;
  seed?: number;
}

const DEFAULTS = {
  hidden: [32, 16],
  learningRate: 0.008,
  l2: 1e-3,
  batchSize: 32,
  maxEpochs: 250,
  earlyStoppingRounds: 25,
  seed: 42,
};

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

function heInit(fanIn: number, fanOut: number, rng: () => number): number[][] {
  const scale = Math.sqrt(2 / Math.max(1, fanIn));
  const W: number[][] = [];
  for (let o = 0; o < fanOut; o++) {
    const row = new Array(fanIn);
    for (let i = 0; i < fanIn; i++) row[i] = (rng() * 2 - 1) * scale;
    W.push(row);
  }
  return W;
}

function columnStats(
  columns: Float64Array[],
  rowIdx: number[],
): { imputes: number[]; means: number[]; stds: number[] } {
  const nCols = columns.length;
  const imputes = new Array(nCols).fill(0);
  const means = new Array(nCols).fill(0);
  const stds = new Array(nCols).fill(1);
  for (let j = 0; j < nCols; j++) {
    const vals: number[] = [];
    for (const i of rowIdx) {
      const v = columns[j][i];
      if (Number.isFinite(v)) vals.push(v);
    }
    if (vals.length === 0) continue;
    vals.sort((a, b) => a - b);
    imputes[j] = vals[Math.floor(vals.length / 2)];
    let sum = 0;
    for (const v of vals) sum += v;
    const mean = sum / vals.length;
    let varSum = 0;
    for (const v of vals) varSum += (v - mean) ** 2;
    means[j] = mean;
    stds[j] = Math.sqrt(varSum / Math.max(1, vals.length)) || 1;
  }
  return { imputes, means, stds };
}

function encodeRow(
  columns: Float64Array[],
  row: number,
  imputes: number[],
  means: number[],
  stds: number[],
  out: Float64Array,
): void {
  for (let j = 0; j < columns.length; j++) {
    let v = columns[j][row];
    if (!Number.isFinite(v)) v = imputes[j];
    out[j] = (v - means[j]) / stds[j];
  }
}

function encodeVec(
  features: number[],
  imputes: number[],
  means: number[],
  stds: number[],
  out: Float64Array,
): void {
  for (let j = 0; j < features.length; j++) {
    let v = features[j];
    if (!Number.isFinite(v)) v = imputes[j];
    out[j] = (v - means[j]) / stds[j];
  }
}

function relu(x: number): number {
  return x > 0 ? x : 0;
}

function forward(
  layers: MlpLayer[],
  x: Float64Array,
  scratch: Float64Array[],
): number {
  let cur = x;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const out = scratch[li];
    const isLast = li === layers.length - 1;
    for (let o = 0; o < layer.bias.length; o++) {
      let s = layer.bias[o];
      const w = layer.weights[o];
      for (let i = 0; i < w.length; i++) s += w[i] * cur[i];
      out[o] = isLast ? s : relu(s);
    }
    cur = out;
  }
  return cur[0];
}

function cloneLayers(layers: MlpLayer[]): MlpLayer[] {
  return layers.map((l) => ({
    weights: l.weights.map((r) => r.slice()),
    bias: l.bias.slice(),
  }));
}

/**
 * Fit an MLP on a column-major feature matrix. `rowIdx` selects training rows;
 * optional `valRowIdx` enables early stopping.
 */
export function fitMlp(
  columns: Float64Array[],
  featureNames: string[],
  rowIdx: number[],
  y: Float64Array,
  sampleWeights: Float64Array | undefined,
  target: string,
  opts: MlpOptions = {},
  valColumns?: Float64Array[],
  valY?: Float64Array,
  valWeights?: Float64Array,
  valRowIdx?: number[],
): MlpModel {
  const hidden = opts.hidden ?? DEFAULTS.hidden;
  const lr = opts.learningRate ?? DEFAULTS.learningRate;
  const l2 = opts.l2 ?? DEFAULTS.l2;
  const batchSize = opts.batchSize ?? DEFAULTS.batchSize;
  const maxEpochs = opts.maxEpochs ?? DEFAULTS.maxEpochs;
  const patience = opts.earlyStoppingRounds ?? DEFAULTS.earlyStoppingRounds;
  const rng = makeRng(opts.seed ?? DEFAULTS.seed);

  const nCols = columns.length;
  const { imputes, means, stds } = columnStats(columns, rowIdx);

  const dims = [nCols, ...hidden, 1];
  const layers: MlpLayer[] = [];
  for (let i = 0; i < dims.length - 1; i++) {
    layers.push({
      weights: heInit(dims[i], dims[i + 1], rng),
      bias: new Array(dims[i + 1]).fill(0),
    });
  }

  // Adam state
  const mW = layers.map((l) => l.weights.map((r) => r.map(() => 0)));
  const vW = layers.map((l) => l.weights.map((r) => r.map(() => 0)));
  const mB = layers.map((l) => l.bias.map(() => 0));
  const vB = layers.map((l) => l.bias.map(() => 0));
  const beta1 = 0.9;
  const beta2 = 0.999;
  const eps = 1e-8;

  const scratch = layers.map((l) => new Float64Array(l.bias.length));
  const preActs = layers.map((l) => new Float64Array(l.bias.length));
  const xBuf = new Float64Array(nCols);
  const order = rowIdx.map((_, i) => i);

  const hasVal =
    valColumns &&
    valY &&
    valRowIdx &&
    valRowIdx.length > 0 &&
    valY.length === valRowIdx.length &&
    valColumns.length === nCols;

  let bestLoss = Infinity;
  let bestEpoch = 0;
  let bestLayers = cloneLayers(layers);
  let bad = 0;
  let trainLoss = 0;
  let valLoss = 0;
  let tStep = 0;

  const evalAligned = (
    cols: Float64Array[],
    globalRows: number[],
    yy: Float64Array,
    ww: Float64Array | undefined,
  ): number => {
    let num = 0;
    let den = 0;
    for (let k = 0; k < globalRows.length; k++) {
      encodeRow(cols, globalRows[k], imputes, means, stds, xBuf);
      const pred = forward(layers, xBuf, scratch);
      const w = ww ? ww[k] : 1;
      num += w * (pred - yy[k]) ** 2;
      den += w;
    }
    return den > 0 ? num / den : Infinity;
  };

  for (let epoch = 0; epoch < maxEpochs; epoch++) {
    // shuffle
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }

    for (let start = 0; start < order.length; start += batchSize) {
      const end = Math.min(order.length, start + batchSize);
      const bsz = end - start;

      // zero grads
      const gW = layers.map((l) => l.weights.map((r) => r.map(() => 0)));
      const gB = layers.map((l) => l.bias.map(() => 0));
      let batchW = 0;

      for (let b = start; b < end; b++) {
        const local = order[b];
        const row = rowIdx[local];
        encodeRow(columns, row, imputes, means, stds, xBuf);
        const w = sampleWeights ? sampleWeights[local] : 1;
        batchW += w;

        // forward with pre-activations for backprop
        let cur: Float64Array = xBuf;
        const acts: Float64Array[] = [xBuf];
        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li];
          const out = scratch[li];
          const pre = preActs[li];
          const isLast = li === layers.length - 1;
          for (let o = 0; o < layer.bias.length; o++) {
            let s = layer.bias[o];
            const ww = layer.weights[o];
            for (let i = 0; i < ww.length; i++) s += ww[i] * cur[i];
            pre[o] = s;
            out[o] = isLast ? s : relu(s);
          }
          cur = out;
          acts.push(Float64Array.from(out));
        }

        const pred = acts[acts.length - 1][0];
        const err = pred - y[local];
        let delta = new Float64Array([w * err]);

        for (let li = layers.length - 1; li >= 0; li--) {
          const layer = layers[li];
          const prevAct = acts[li];
          const pre = preActs[li];
          const nextDelta = new Float64Array(prevAct.length);

          for (let o = 0; o < layer.bias.length; o++) {
            let d = delta[o];
            if (li < layers.length - 1 && pre[o] <= 0) d = 0; // ReLU'
            gB[li][o] += d;
            const ww = layer.weights[o];
            for (let i = 0; i < ww.length; i++) {
              gW[li][o][i] += d * prevAct[i];
              nextDelta[i] += d * ww[i];
            }
          }
          delta = nextDelta;
        }
      }

      const scale = batchW > 0 ? 1 / batchW : 1 / Math.max(1, bsz);
      tStep++;
      const corr1 = 1 - beta1 ** tStep;
      const corr2 = 1 - beta2 ** tStep;

      for (let li = 0; li < layers.length; li++) {
        const layer = layers[li];
        for (let o = 0; o < layer.bias.length; o++) {
          let gb = gB[li][o] * scale;
          // Gradient clip for tabular stability on small n.
          gb = Math.max(-5, Math.min(5, gb));
          mB[li][o] = beta1 * mB[li][o] + (1 - beta1) * gb;
          vB[li][o] = beta2 * vB[li][o] + (1 - beta2) * gb * gb;
          layer.bias[o] -=
            (lr * (mB[li][o] / corr1)) / (Math.sqrt(vB[li][o] / corr2) + eps);
          if (!Number.isFinite(layer.bias[o])) layer.bias[o] = 0;

          const ww = layer.weights[o];
          for (let i = 0; i < ww.length; i++) {
            let gw = gW[li][o][i] * scale + l2 * ww[i];
            gw = Math.max(-5, Math.min(5, gw));
            mW[li][o][i] = beta1 * mW[li][o][i] + (1 - beta1) * gw;
            vW[li][o][i] = beta2 * vW[li][o][i] + (1 - beta2) * gw * gw;
            ww[i] -=
              (lr * (mW[li][o][i] / corr1)) /
              (Math.sqrt(vW[li][o][i] / corr2) + eps);
            if (!Number.isFinite(ww[i])) ww[i] = 0;
          }
        }
      }
    }

    trainLoss = evalAligned(columns, rowIdx, y, sampleWeights);
    if (hasVal) {
      valLoss = evalAligned(valColumns!, valRowIdx!, valY!, valWeights);
    } else {
      valLoss = trainLoss;
    }

    const monitor = hasVal ? valLoss : trainLoss;
    if (monitor + 1e-9 < bestLoss) {
      bestLoss = monitor;
      bestEpoch = epoch;
      bestLayers = cloneLayers(layers);
      bad = 0;
    } else if (++bad >= patience) {
      break;
    }
  }

  return {
    modelType: "mlp",
    target,
    featureNames: [...featureNames],
    imputes,
    means,
    stds,
    layers: bestLayers,
    bestEpoch,
    trainLoss,
    valLoss: bestLoss,
  };
}

export function predictMlp(model: MlpModel, features: number[]): number {
  const x = new Float64Array(model.featureNames.length);
  encodeVec(features, model.imputes, model.means, model.stds, x);
  const scratch = model.layers.map((l) => new Float64Array(l.bias.length));
  const pred = forward(model.layers, x, scratch);
  return Number.isFinite(pred) ? pred : 0;
}

export function predictMlpBatch(
  model: MlpModel,
  columns: Float64Array[],
): Float64Array {
  const n = columns[0]?.length ?? 0;
  const out = new Float64Array(n);
  const x = new Float64Array(model.featureNames.length);
  const scratch = model.layers.map((l) => new Float64Array(l.bias.length));
  const vec = new Array(model.featureNames.length);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < vec.length; j++) vec[j] = columns[j][i];
    encodeVec(vec, model.imputes, model.means, model.stds, x);
    const pred = forward(model.layers, x, scratch);
    out[i] = Number.isFinite(pred) ? pred : 0;
  }
  return out;
}
