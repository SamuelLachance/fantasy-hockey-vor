/**
 * Histogram-based gradient-boosted regression trees (least-squares boosting).
 *
 * Replaces the old depth-1 stump booster: proper depth-N trees with
 * quantile-binned features, row/column subsampling, L2 leaf regularization,
 * and early stopping on a validation set. Pure TypeScript, tuned for
 * ~10-20k rows × ~250 features workloads.
 */

export interface GbdtNode {
  /** -1 for leaves. */
  featureIndex: number;
  /** Bin threshold (values <= threshold go left) in raw feature space. */
  threshold: number;
  /** Bin index for the training-time binned fast path. */
  splitBin: number;
  left: number;
  right: number;
  /** Leaf value (only meaningful when featureIndex === -1). */
  value: number;
  /** Which side missing/NaN goes to (true = left). */
  defaultLeft: boolean;
}

export interface GbdtTree {
  nodes: GbdtNode[];
}

export interface GbdtModel {
  modelType: "gbdt";
  target: string;
  featureNames: string[];
  baseScore: number;
  learningRate: number;
  trees: GbdtTree[];
  bestIteration: number;
}

export interface GbdtOptions {
  nEstimators?: number;
  learningRate?: number;
  maxDepth?: number;
  minChildWeight?: number;
  lambda?: number;
  subsample?: number;
  colsampleByTree?: number;
  maxBins?: number;
  earlyStoppingRounds?: number;
  seed?: number;
}

const DEFAULTS: Required<GbdtOptions> = {
  nEstimators: 400,
  learningRate: 0.05,
  maxDepth: 3,
  minChildWeight: 8,
  lambda: 1.0,
  subsample: 0.8,
  colsampleByTree: 0.7,
  maxBins: 32,
  earlyStoppingRounds: 25,
  seed: 17,
};

/** Deterministic xorshift PRNG so training is reproducible. */
function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}

interface BinnedMatrix {
  /** bins[j] = Uint8Array over rows; 255 = missing (maxBins must be < 255). */
  bins: Uint8Array[];
  /** binEdges[j][b] = upper raw-value edge for bin b. */
  binEdges: number[][];
  nRows: number;
  nCols: number;
}

export function binFeatures(
  X: Float64Array[],
  maxBins: number,
): BinnedMatrix {
  const nCols = X.length;
  const nRows = X[0]?.length ?? 0;
  const bins: Uint8Array[] = new Array(nCols);
  const binEdges: number[][] = new Array(nCols);

  for (let j = 0; j < nCols; j++) {
    const col = X[j];
    const finite: number[] = [];
    for (let i = 0; i < nRows; i++) {
      const v = col[i];
      if (Number.isFinite(v)) finite.push(v);
    }
    finite.sort((a, b) => a - b);

    const edges: number[] = [];
    if (finite.length > 0) {
      const uniq: number[] = [];
      for (let i = 0; i < finite.length; i++) {
        if (i === 0 || finite[i] !== finite[i - 1]) uniq.push(finite[i]);
      }
      if (uniq.length <= maxBins) {
        for (let k = 0; k < uniq.length - 1; k++) {
          edges.push((uniq[k] + uniq[k + 1]) / 2);
        }
      } else {
        for (let b = 1; b < maxBins; b++) {
          const q = finite[Math.floor((b / maxBins) * (finite.length - 1))];
          if (edges.length === 0 || q > edges[edges.length - 1]) edges.push(q);
        }
      }
    }
    binEdges[j] = edges;

    const colBins = new Uint8Array(nRows);
    for (let i = 0; i < nRows; i++) {
      const v = col[i];
      if (!Number.isFinite(v)) {
        colBins[i] = 255;
        continue;
      }
      // Binary search into edges.
      let lo = 0;
      let hi = edges.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (v <= edges[mid]) hi = mid;
        else lo = mid + 1;
      }
      colBins[i] = lo;
    }
    bins[j] = colBins;
  }

  return { bins, binEdges, nRows, nCols };
}

interface SplitResult {
  gain: number;
  featureIndex: number;
  bin: number;
  defaultLeft: boolean;
}

export function fitGbdt(
  X: Float64Array[],
  y: Float64Array,
  featureNames: string[],
  target: string,
  sampleWeights?: Float64Array,
  options: GbdtOptions = {},
  valX?: Float64Array[],
  valY?: Float64Array,
  valWeights?: Float64Array,
): GbdtModel {
  const opt = { ...DEFAULTS, ...options };
  const nRows = y.length;
  const nCols = X.length;
  if (nRows === 0 || nCols === 0) {
    throw new Error(`gbdt(${target}): empty training data`);
  }
  const rng = makeRng(opt.seed);
  const binned = binFeatures(X, opt.maxBins);

  const w = sampleWeights ?? new Float64Array(nRows).fill(1);
  let wSum = 0;
  let ywSum = 0;
  for (let i = 0; i < nRows; i++) {
    wSum += w[i];
    ywSum += w[i] * y[i];
  }
  const baseScore = wSum > 0 ? ywSum / wSum : 0;

  const pred = new Float64Array(nRows).fill(baseScore);
  const trees: GbdtTree[] = [];

  // Validation state for early stopping.
  const useVal = valX && valY && valY.length > 0;
  const valPred = useVal ? new Float64Array(valY.length).fill(baseScore) : null;
  let bestValLoss = Infinity;
  let bestIteration = 0;
  let roundsSinceBest = 0;

  const rowIdx = new Int32Array(nRows);
  const grad = new Float64Array(nRows);

  const nodeOfRow = new Int32Array(nRows);

  for (let iter = 0; iter < opt.nEstimators; iter++) {
    // Gradient of squared loss = residual.
    for (let i = 0; i < nRows; i++) grad[i] = y[i] - pred[i];

    // Row subsample.
    let nSampled = 0;
    for (let i = 0; i < nRows; i++) {
      if (opt.subsample >= 1 || rng() < opt.subsample) {
        rowIdx[nSampled++] = i;
      }
    }
    if (nSampled < 16) continue;

    // Column subsample.
    const cols: number[] = [];
    for (let j = 0; j < nCols; j++) {
      if (opt.colsampleByTree >= 1 || rng() < opt.colsampleByTree) cols.push(j);
    }
    if (cols.length === 0) cols.push(Math.floor(rng() * nCols));

    const nodes: GbdtNode[] = [
      { featureIndex: -1, threshold: 0, splitBin: 0, left: -1, right: -1, value: 0, defaultLeft: true },
    ];
    // All sampled rows start at root (node 0).
    for (let k = 0; k < nSampled; k++) nodeOfRow[rowIdx[k]] = 0;

    let frontier = [0];
    // Active rows: sampled rows sitting at a frontier node.
    const active = rowIdx.slice(0, nSampled);
    let nActive = nSampled;

    for (let depth = 0; depth < opt.maxDepth && frontier.length > 0; depth++) {
      // Frontier nodes occupy a contiguous id range starting at frontier[0]
      // (children are appended in creation order each depth).
      const frontierLo = frontier[0];
      const nFrontier = frontier.length;
      const nCols2 = cols.length;
      const binsStride = opt.maxBins;

      // Flat histograms: [frontierNode][col][bin] and missing accumulators.
      const histG = new Float64Array(nFrontier * nCols2 * binsStride);
      const histW = new Float64Array(nFrontier * nCols2 * binsStride);
      const histGMissing = new Float64Array(nFrontier * nCols2);
      const histWMissing = new Float64Array(nFrontier * nCols2);

      // Per-active-row cached values (column-outer accumulation).
      const rowF = new Int32Array(nActive);
      const rowG = new Float64Array(nActive);
      const rowW = new Float64Array(nActive);
      for (let k = 0; k < nActive; k++) {
        const i = active[k];
        rowF[k] = nodeOfRow[i] - frontierLo;
        rowG[k] = grad[i] * w[i];
        rowW[k] = w[i];
      }

      for (let c = 0; c < nCols2; c++) {
        const colBins = binned.bins[cols[c]];
        const missBase = c;
        const histBase = c * binsStride;
        for (let k = 0; k < nActive; k++) {
          const f = rowF[k];
          const bin = colBins[active[k]];
          if (bin === 255) {
            const off = f * nCols2 + missBase;
            histGMissing[off] += rowG[k];
            histWMissing[off] += rowW[k];
          } else {
            const off = f * nCols2 * binsStride + histBase + bin;
            histG[off] += rowG[k];
            histW[off] += rowW[k];
          }
        }
      }

      // Decide the best split for each frontier node.
      const splitOfNode = new Map<number, SplitResult>();
      for (const node of frontier) {
        const f = node - frontierLo;
        const baseH = f * nCols2 * binsStride;
        const baseM = f * nCols2;

        let totalG = 0;
        let totalW = 0;
        for (let b = 0; b < binsStride; b++) {
          totalG += histG[baseH + b];
          totalW += histW[baseH + b];
        }
        totalG += histGMissing[baseM];
        totalW += histWMissing[baseM];

        if (totalW < 2 * opt.minChildWeight) continue;

        const parentScore = (totalG * totalG) / (totalW + opt.lambda);
        let best: SplitResult | null = null;

        for (let c = 0; c < nCols2; c++) {
          const colOff = baseH + c * binsStride;
          const gm = histGMissing[baseM + c];
          const wm = histWMissing[baseM + c];
          // Try missing→left and missing→right.
          for (const missLeft of [true, false]) {
            let leftG = missLeft ? gm : 0;
            let leftW = missLeft ? wm : 0;
            for (let b = 0; b < binsStride - 1; b++) {
              leftG += histG[colOff + b];
              leftW += histW[colOff + b];
              const rightG = totalG - leftG;
              const rightW = totalW - leftW;
              if (leftW < opt.minChildWeight || rightW < opt.minChildWeight) continue;
              const gain =
                (leftG * leftG) / (leftW + opt.lambda) +
                (rightG * rightG) / (rightW + opt.lambda) -
                parentScore;
              if (gain > 1e-10 && (!best || gain > best.gain)) {
                best = { gain, featureIndex: c, bin: b, defaultLeft: missLeft };
              }
            }
          }
        }

        if (best) splitOfNode.set(node, best);
      }

      // Materialize splits (children get contiguous ids in frontier order).
      const nextFrontier: number[] = [];
      for (const node of frontier) {
        const best = splitOfNode.get(node);
        if (!best) continue;
        const col = cols[best.featureIndex];
        const edges = binned.binEdges[col];
        // bin <= b ⟺ v <= edges[b] only when b < edges.length; a split at or
        // beyond the last edge separates only missing vs present, which is
        // threshold = +Infinity in raw space.
        const threshold =
          best.bin < edges.length ? edges[best.bin] : Number.POSITIVE_INFINITY;

        const leftId = nodes.length;
        const rightId = nodes.length + 1;
        nodes.push({
          featureIndex: -1, threshold: 0, splitBin: 0, left: -1, right: -1, value: 0, defaultLeft: true,
        });
        nodes.push({
          featureIndex: -1, threshold: 0, splitBin: 0, left: -1, right: -1, value: 0, defaultLeft: true,
        });
        nodes[node] = {
          featureIndex: col,
          threshold,
          splitBin: best.bin,
          left: leftId,
          right: rightId,
          value: 0,
          defaultLeft: best.defaultLeft,
        };
        nextFrontier.push(leftId, rightId);
      }

      // Route active rows once per depth and compact to rows still in play.
      let nNext = 0;
      for (let k = 0; k < nActive; k++) {
        const i = active[k];
        const node = nodeOfRow[i];
        const spec = nodes[node];
        if (spec.featureIndex === -1) continue; // settled leaf
        const bin = binned.bins[spec.featureIndex][i];
        const goLeft = bin === 255 ? spec.defaultLeft : bin <= spec.splitBin;
        nodeOfRow[i] = goLeft ? spec.left : spec.right;
        active[nNext++] = i;
      }
      nActive = nNext;
      frontier = nextFrontier;
    }

    // Leaf values: shrunk weighted mean of residuals.
    const leafG = new Float64Array(nodes.length);
    const leafW = new Float64Array(nodes.length);
    for (let k = 0; k < nSampled; k++) {
      const i = rowIdx[k];
      const node = nodeOfRow[i];
      leafG[node] += grad[i] * w[i];
      leafW[node] += w[i];
    }
    let anySplit = false;
    for (let n = 0; n < nodes.length; n++) {
      if (nodes[n].featureIndex === -1) {
        nodes[n].value = leafG[n] / (leafW[n] + opt.lambda);
      } else {
        anySplit = true;
      }
    }
    if (!anySplit) break;

    const tree: GbdtTree = { nodes };
    trees.push(tree);

    // Update train predictions (all rows, not just sampled).
    for (let i = 0; i < nRows; i++) {
      pred[i] += opt.learningRate * predictTreeBinned(tree, binned, i);
    }

    // Early stopping on validation loss.
    if (useVal && valPred && valX && valY) {
      for (let i = 0; i < valY.length; i++) {
        valPred[i] += opt.learningRate * predictTreeRaw(tree, valX, i);
      }
      let loss = 0;
      let lossW = 0;
      for (let i = 0; i < valY.length; i++) {
        const wt = valWeights?.[i] ?? 1;
        const e = valY[i] - valPred[i];
        loss += wt * e * e;
        lossW += wt;
      }
      loss /= Math.max(1e-9, lossW);
      if (loss < bestValLoss - 1e-9) {
        bestValLoss = loss;
        bestIteration = trees.length;
        roundsSinceBest = 0;
      } else {
        roundsSinceBest++;
        if (roundsSinceBest >= opt.earlyStoppingRounds) break;
      }
    }
  }

  const finalTrees = useVal && bestIteration > 0 ? trees.slice(0, bestIteration) : trees;

  return {
    modelType: "gbdt",
    target,
    featureNames,
    baseScore,
    learningRate: opt.learningRate,
    trees: finalTrees,
    bestIteration: finalTrees.length,
  };
}

function predictTreeBinned(tree: GbdtTree, binned: BinnedMatrix, row: number): number {
  let n = 0;
  for (;;) {
    const node = tree.nodes[n];
    if (node.featureIndex === -1) return node.value;
    const bin = binned.bins[node.featureIndex][row];
    if (bin === 255) {
      n = node.defaultLeft ? node.left : node.right;
      continue;
    }
    n = bin <= node.splitBin ? node.left : node.right;
  }
}

function predictTreeRaw(tree: GbdtTree, X: Float64Array[], row: number): number {
  let n = 0;
  for (;;) {
    const node = tree.nodes[n];
    if (node.featureIndex === -1) return node.value;
    const v = X[node.featureIndex][row];
    if (!Number.isFinite(v)) {
      n = node.defaultLeft ? node.left : node.right;
    } else {
      n = v <= node.threshold ? node.left : node.right;
    }
  }
}

export function predictGbdt(model: GbdtModel, features: number[]): number {
  let out = model.baseScore;
  for (const tree of model.trees) {
    let n = 0;
    for (;;) {
      const node = tree.nodes[n];
      if (node.featureIndex === -1) {
        out += model.learningRate * node.value;
        break;
      }
      const v = features[node.featureIndex];
      if (!Number.isFinite(v)) {
        n = node.defaultLeft ? node.left : node.right;
      } else {
        n = v <= node.threshold ? node.left : node.right;
      }
    }
  }
  return out;
}

/** Column-major batch prediction (fast path for backtests). */
export function predictGbdtBatch(model: GbdtModel, X: Float64Array[]): Float64Array {
  const n = X[0]?.length ?? 0;
  const out = new Float64Array(n).fill(model.baseScore);
  for (const tree of model.trees) {
    for (let i = 0; i < n; i++) {
      out[i] += model.learningRate * predictTreeRaw(tree, X, i);
    }
  }
  return out;
}
