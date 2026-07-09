import type { SkaterCategory } from "../types";
import { DEFAULT_LEAGUE } from "../league";
import { computeCategoryDifficultyWeights } from "../stat-difficulty";
import type { SkaterProjection } from "../types";

/** Spearman rank correlation in [-1, 1]. */
export function spearmanCorrelation(yTrue: number[], yPred: number[]): number {
  const n = yTrue.length;
  if (n < 3) return 0;

  function ranks(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const out = Array(n).fill(0);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j + 1 < n && indexed[j + 1].v === indexed[i].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) out[indexed[k].i] = avgRank;
      i = j + 1;
    }
    return out;
  }

  const rTrue = ranks(yTrue);
  const rPred = ranks(yPred);
  let d2 = 0;
  for (let i = 0; i < n; i++) d2 += (rTrue[i] - rPred[i]) ** 2;
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/** Composite champion score: ranking-first (Spearman), then R². */
export function championSelectionScore(yTrue: number[], yPred: number[], r2: number): number {
  const spear = spearmanCorrelation(yTrue, yPred);
  const r2Norm = Math.max(-0.5, Math.min(1, r2));
  return spear * 0.65 + ((r2Norm + 0.5) / 1.5) * 0.35;
}

/** GP champion score: accuracy within 10 GP + rank correlation. */
export function gpSelectionScore(
  yTrue: number[],
  yPred: number[],
  r2: number,
): number {
  if (yTrue.length === 0) return -Infinity;
  let within10 = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (Math.abs(yTrue[i] - yPred[i]) <= 10) within10++;
  }
  const acc = within10 / yTrue.length;
  const spear = spearmanCorrelation(yTrue, yPred);
  return acc * 0.35 + spear * 0.5 + Math.max(0, r2) * 0.15;
}

function skaterFantasyValue(
  projection: SkaterProjection,
  weights: Record<SkaterCategory, { weight: number }>,
): number {
  let total = 0;
  for (const [cat, meta] of Object.entries(weights) as [SkaterCategory, { weight: number }][]) {
    total += (projection[cat] ?? 0) * meta.weight;
  }
  return total;
}

/** Mean absolute error of weighted fantasy points across holdout skaters. */
export function skaterFantasyPointsMae(
  actualRates: Record<string, number[]>,
  predRates: Record<string, number[]>,
  gp: number[],
): number {
  const n = gp.length;
  if (n === 0) return Infinity;

  const stubPlayers = Array.from({ length: n }, (_, i) => ({
    isGoalie: false as const,
    positions: ["C" as const],
    gamesPlayed: gp[i],
    projection: {
      goals: predRates.goals?.[i] ?? 0,
      assists: predRates.assists?.[i] ?? 0,
      shots: predRates.shots?.[i] ?? 0,
      blocks: predRates.blocks?.[i] ?? 0,
      hits: predRates.hits?.[i] ?? 0,
      powerplayPoints: predRates.powerplayPoints?.[i] ?? 0,
      penaltyMinutes: predRates.penaltyMinutes?.[i] ?? 0,
      faceoffWins: predRates.faceoffWins?.[i] ?? 0,
    } satisfies SkaterProjection,
  }));

  const actualPlayers = stubPlayers.map((p, i) => ({
    ...p,
    projection: {
      ...p.projection,
      goals: (actualRates.goals?.[i] ?? 0) * gp[i],
      assists: (actualRates.assists?.[i] ?? 0) * gp[i],
      shots: (actualRates.shots?.[i] ?? 0) * gp[i],
      blocks: (actualRates.blocks?.[i] ?? 0) * gp[i],
      hits: (actualRates.hits?.[i] ?? 0) * gp[i],
      powerplayPoints: (actualRates.powerplayPoints?.[i] ?? 0) * gp[i],
      penaltyMinutes: (actualRates.penaltyMinutes?.[i] ?? 0) * gp[i],
      faceoffWins: (actualRates.faceoffWins?.[i] ?? 0) * gp[i],
    },
  }));

  const predSeason = stubPlayers.map((p, i) => ({
    ...p,
    projection: {
      goals: p.projection.goals * gp[i],
      assists: p.projection.assists * gp[i],
      shots: p.projection.shots * gp[i],
      blocks: p.projection.blocks * gp[i],
      hits: p.projection.hits * gp[i],
      powerplayPoints: p.projection.powerplayPoints * gp[i],
      penaltyMinutes: p.projection.penaltyMinutes * gp[i],
      faceoffWins: p.projection.faceoffWins * gp[i],
    },
  }));

  const weights = computeCategoryDifficultyWeights(
    predSeason as Parameters<typeof computeCategoryDifficultyWeights>[0],
    DEFAULT_LEAGUE,
  ).skater;

  let mae = 0;
  for (let i = 0; i < n; i++) {
    const predFv = skaterFantasyValue(
      predSeason[i].projection as SkaterProjection,
      weights,
    );
    const actFv = skaterFantasyValue(
      actualPlayers[i].projection as SkaterProjection,
      weights,
    );
    mae += Math.abs(predFv - actFv);
  }
  return mae / n;
}
