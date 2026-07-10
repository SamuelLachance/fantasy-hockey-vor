/**
 * Marcel-style projection with empirical-Bayes shrinkage and data-driven
 * aging curves, fit per training boundary (no leakage).
 *
 * rate_hat = ageAdj × [ Σ w_k·stat_k + K·prior ] / [ Σ w_k·gp_k + K ]
 *
 * - w_k: per-stat recency decay fit on train
 * - K: shrinkage prior strength (in games) from variance decomposition
 * - prior: position-group mean rate on train
 * - ageAdj: cumulative aging curve from train delta pairs
 */

import { gp82, eligibleHistory, actualRate } from "./dataset-view";
import type { PlayerSeasonRow } from "./types";

export const MARCEL_TARGETS = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
] as const;

export type MarcelTarget = (typeof MARCEL_TARGETS)[number];

export interface AgingCurve {
  /** Multiplier on rate at each age (index = age − MIN_AGE), cumulative, =1 at 26. */
  multipliers: number[];
  minAge: number;
  maxAge: number;
}

export interface MarcelParams {
  target: string;
  /** Season weight decay (weight_k = decay^(k−1) for k-th most recent). */
  decay: number;
  /** Prior strength in games. */
  priorGames: number;
  /** Prior mean rate per position group. */
  priorRate: { F: number; D: number };
  agingF: AgingCurve;
  agingD: AgingCurve;
}

const MIN_AGE = 18;
const MAX_AGE = 44;

export function agingMultiplier(curve: AgingCurve, age: number): number {
  if (!Number.isFinite(age) || age <= 0) return 1;
  const idx = Math.round(Math.max(curve.minAge, Math.min(curve.maxAge, age))) - curve.minAge;
  return curve.multipliers[idx] ?? 1;
}

/**
 * Delta-method aging curve: median rate ratio between consecutive seasons
 * bucketed by age, smoothed, and chained into a cumulative curve normalized
 * to 1.0 at age 26.
 */
export function fitAgingCurve(
  rows: PlayerSeasonRow[],
  target: string,
  positionGroup: "F" | "D",
): AgingCurve {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    if (row.isGoalie) continue;
    const group = row.position === "D" ? "D" : "F";
    if (group !== positionGroup) continue;
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  // ratios[ageIdx] = list of (rate_{t+1}/rate_t) for players aged `age` in season t+1
  const ratios: number[][] = Array.from({ length: MAX_AGE - MIN_AGE + 1 }, () => []);
  for (const list of byPlayer.values()) {
    list.sort((a, b) => a.seasonId - b.seasonId);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const cur = list[i];
      if (cur.seasonId - prev.seasonId !== 10001) continue;
      if (gp82(prev) < 40 || gp82(cur) < 40) continue;
      const age = cur.age ?? 0;
      if (age < MIN_AGE || age > MAX_AGE) continue;
      const ratePrev = actualRate(prev, target);
      const rateCur = actualRate(cur, target);
      if (ratePrev < 0.02) continue;
      const ratio = Math.max(0.3, Math.min(3, rateCur / ratePrev));
      ratios[age - MIN_AGE].push(ratio);
    }
  }

  // Median ratio per age with sample-size-aware shrink toward 1.
  const yearly: number[] = ratios.map((list) => {
    if (list.length < 8) return 1;
    const sorted = [...list].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const w = Math.min(1, list.length / 40);
    return 1 + (median - 1) * w;
  });

  // Light smoothing (3-point moving average).
  const smoothed = yearly.map((v, i) => {
    const prev = yearly[i - 1] ?? v;
    const next = yearly[i + 1] ?? v;
    return prev * 0.25 + v * 0.5 + next * 0.25;
  });

  // Chain into cumulative curve; normalize at age 26.
  const cumulative: number[] = new Array(smoothed.length).fill(1);
  for (let i = 1; i < smoothed.length; i++) {
    cumulative[i] = cumulative[i - 1] * smoothed[i];
  }
  const anchor = cumulative[26 - MIN_AGE] || 1;
  const multipliers = cumulative.map((v) => Math.max(0.35, Math.min(1.8, v / anchor)));

  return { multipliers, minAge: MIN_AGE, maxAge: MAX_AGE };
}

/** Prior strength (games) via variance decomposition: K = m/σ²_between. */
function fitPriorGames(rows: PlayerSeasonRow[], target: string): number {
  const rates: number[] = [];
  const gps: number[] = [];
  for (const row of rows) {
    if (row.isGoalie || row.gamesPlayed < 20) continue;
    rates.push(actualRate(row, target));
    gps.push(row.gamesPlayed);
  }
  if (rates.length < 200) return 60;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const obsVar =
    rates.reduce((s, r) => s + (r - mean) ** 2, 0) / Math.max(1, rates.length - 1);
  // Poisson-like within-season sampling variance of a per-game rate ≈ rate/gp.
  const withinVar =
    rates.reduce((s, r, i) => s + Math.max(0.0001, r) / gps[i], 0) / rates.length;
  const betweenVar = Math.max(1e-6, obsVar - withinVar);
  const k = mean / betweenVar;
  return Math.max(5, Math.min(400, k));
}

function fitPriorRate(rows: PlayerSeasonRow[], target: string): { F: number; D: number } {
  let sumF = 0;
  let gpF = 0;
  let sumD = 0;
  let gpD = 0;
  for (const row of rows) {
    if (row.isGoalie || row.gamesPlayed < 10) continue;
    const v = (row as unknown as Record<string, number>)[target] ?? 0;
    if (row.position === "D") {
      sumD += v;
      gpD += row.gamesPlayed;
    } else {
      sumF += v;
      gpF += row.gamesPlayed;
    }
  }
  return {
    F: gpF > 0 ? sumF / gpF : 0,
    D: gpD > 0 ? sumD / gpD : 0,
  };
}

/** Grid-fit the recency decay per stat by next-season prediction MSE on train pairs. */
function fitDecay(rows: PlayerSeasonRow[], target: string): number {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    if (row.isGoalie) continue;
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }
  for (const list of byPlayer.values()) list.sort((a, b) => a.seasonId - b.seasonId);

  const grid = [0.4, 0.5, 0.6, 0.7, 0.8];
  let bestDecay = 0.6;
  let bestErr = Infinity;

  for (const decay of grid) {
    let err = 0;
    let n = 0;
    for (const list of byPlayer.values()) {
      for (let i = 1; i < list.length; i++) {
        const cur = list[i];
        if (cur.gamesPlayed < 40) continue;
        const prior = eligibleHistory(list.slice(0, i)).slice(-3);
        if (prior.length < 2) continue;
        let num = 0;
        let den = 0;
        for (let k = 0; k < prior.length; k++) {
          const row = prior[prior.length - 1 - k];
          const w = Math.pow(decay, k);
          num += w * ((row as unknown as Record<string, number>)[target] ?? 0);
          den += w * row.gamesPlayed;
        }
        if (den <= 0) continue;
        const pred = num / den;
        const actual = actualRate(cur, target);
        err += (pred - actual) ** 2;
        n++;
      }
    }
    if (n > 0 && err / n < bestErr) {
      bestErr = err / n;
      bestDecay = decay;
    }
  }
  return bestDecay;
}

export function fitMarcelParams(
  trainRows: PlayerSeasonRow[],
  target: string,
): MarcelParams {
  return {
    target,
    decay: fitDecay(trainRows, target),
    priorGames: fitPriorGames(trainRows, target),
    priorRate: fitPriorRate(trainRows, target),
    agingF: fitAgingCurve(trainRows, target, "F"),
    agingD: fitAgingCurve(trainRows, target, "D"),
  };
}

/** Marcel per-game rate projection for one player. */
export function marcelRate(
  params: MarcelParams,
  history: PlayerSeasonRow[],
  target: PlayerSeasonRow,
): number {
  const eligible = eligibleHistory(history).slice(-4);
  const group = target.position === "D" ? "D" : "F";
  const prior = params.priorRate[group];

  let num = 0;
  let den = 0;
  let lastAge = NaN;
  for (let k = 0; k < eligible.length; k++) {
    const row = eligible[eligible.length - 1 - k];
    const w = Math.pow(params.decay, k);
    num += w * ((row as unknown as Record<string, number>)[params.target] ?? 0);
    den += w * row.gamesPlayed;
    if (k === 0) lastAge = row.age ?? NaN;
  }

  const shrunk = (num + params.priorGames * prior) / (den + params.priorGames);

  const curve = group === "D" ? params.agingD : params.agingF;
  const targetAge = target.age && target.age > 0 ? target.age : NaN;
  let ageAdj = 1;
  if (Number.isFinite(targetAge)) {
    const from = Number.isFinite(lastAge) && lastAge > 0 ? lastAge : targetAge - 1;
    const mTo = agingMultiplier(curve, targetAge);
    const mFrom = agingMultiplier(curve, from);
    ageAdj = mFrom > 0 ? mTo / mFrom : 1;
    ageAdj = Math.max(0.7, Math.min(1.25, ageAdj));
  }

  if (params.target === "faceoffWins" && target.position !== "C") return 0;

  return Math.max(0, shrunk * ageAdj);
}

/** Simple EWMA per-game rate over up to 3 eligible prior seasons (0.5/0.3/0.2). */
export function ewmaRate(history: PlayerSeasonRow[], target: string): number {
  const eligible = eligibleHistory(history).slice(-3);
  if (eligible.length === 0) return NaN;
  const w = [0.5, 0.3, 0.2];
  let sum = 0;
  let wSum = 0;
  for (let k = 0; k < eligible.length; k++) {
    const row = eligible[eligible.length - 1 - k];
    sum += w[k] * actualRate(row, target);
    wSum += w[k];
  }
  return sum / wSum;
}

export function lag1Rate(history: PlayerSeasonRow[], target: string): number {
  const eligible = eligibleHistory(history);
  if (eligible.length === 0) return NaN;
  return actualRate(eligible[eligible.length - 1], target);
}

/**
 * Component model for goals: projected shot volume × EB-shrunk shooting
 * percentage (xG-informed when MoneyPuck data exists).
 */
export function componentGoalsRate(
  shotsParams: MarcelParams,
  history: PlayerSeasonRow[],
  target: PlayerSeasonRow,
): number {
  const eligible = eligibleHistory(history);
  if (eligible.length === 0) return NaN;

  const projShotsPg = marcelRate(shotsParams, history, target);

  // Career-weighted shooting% shrunk toward position mean, informed by xG.
  const group = target.position === "D" ? "D" : "F";
  const priorShPct = group === "D" ? 0.055 : 0.105;
  const priorShots = 250;

  let goals = 0;
  let shots = 0;
  let xg = 0;
  let hasXg = false;
  let w = 1;
  for (let k = eligible.length - 1; k >= 0; k--) {
    const row = eligible[k];
    goals += w * row.goals;
    shots += w * row.shots;
    if (row.xGoals != null && row.xGoals > 0) {
      xg += w * row.xGoals;
      hasXg = true;
    }
    w *= 0.75;
  }
  if (shots <= 0) return NaN;

  // Blend actual goals with xG (xG is a less noisy estimate of chance quality).
  const scoringNumerator = hasXg && xg > 0 ? goals * 0.6 + xg * 0.4 : goals;
  const ebShPct =
    (scoringNumerator + priorShots * priorShPct) / (shots + priorShots);

  return Math.max(0, projShotsPg * ebShPct);
}
