import { rookieSkaterProjection } from "../projections";
import type { PlayerSeasonRow } from "./types";

export const EWMA_SEASON_WEIGHTS = [0.15, 0.3, 0.55];

/** Stats where young-player projections benefit from strong cohort shrinkage. */
export const VOLATILE_LOW_HISTORY_TARGETS = new Set([
  "goals",
  "assists",
  "hits",
  "penaltyMinutes",
]);

const LEAGUE_TEAM_PIM_PG = 8.5;
const LEAGUE_TEAM_HITS_PG = 22;

function rowStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

export function ageCurveMult(position: string, age: number): number {
  if (position === "D") {
    if (age <= 23) return 1.07;
    if (age <= 27) return 1.02;
    if (age >= 34) return 0.92;
    return 1;
  }
  if (age <= 22) return 1.09;
  if (age <= 26) return 1.04;
  if (age >= 33) return 0.91;
  if (age >= 36) return 0.84;
  return 1;
}

export function draftPedigreeMult(draftOverall: number, age: number): number {
  if (draftOverall <= 0) return 0.95;
  if (draftOverall <= 15 && age <= 26) return 1.08;
  if (draftOverall <= 50 && age <= 24) return 1.04;
  if (draftOverall >= 120) return 0.97;
  return 1;
}

export function rookieRatePerGame(position: string, target: string): number {
  const pos = position as "C" | "LW" | "RW" | "D";
  const baseline = rookieSkaterProjection(
    pos === "D" ? "D" : pos in { C: 1, LW: 1, RW: 1 } ? pos : "C",
  );
  const gp = 82;
  const map: Record<string, number> = {
    goals: baseline.goals / gp,
    assists: baseline.assists / gp,
    shots: baseline.shots / gp,
    blocks: baseline.blocks / gp,
    hits: baseline.hits / gp,
    powerplayPoints: baseline.powerplayPoints / gp,
    penaltyMinutes: baseline.penaltyMinutes / gp,
    faceoffWins: baseline.faceoffWins / gp,
  };
  return map[target] ?? 0;
}

function empiricalBayesShrink(
  observed: number,
  prior: number,
  nSeasons: number,
  priorStrength: number,
): number {
  const w = nSeasons / (nSeasons + priorStrength);
  return observed * w + prior * (1 - w);
}

/**
 * Per-game rate anchor for low-history players: EWMA history + position/age/draft prior.
 */
export function contextualPerGameRateFromRows(
  prior: PlayerSeasonRow[],
  targetSeason: PlayerSeasonRow,
  target: string,
): number {
  const eligible = prior.filter((r) => r.gamesPlayed >= 10);
  const age = targetSeason.age ?? 27;
  const draftMult = draftPedigreeMult(targetSeason.draftOverallPick ?? 0, age);
  const ageMult = ageCurveMult(targetSeason.position, age);
  const posGroup = targetSeason.position === "D" ? "D" : "F";

  let rate = 0;
  if (eligible.length > 0) {
    const recent = eligible.slice(-3);
    const weights = EWMA_SEASON_WEIGHTS.slice(-recent.length);
    const totalW = weights.reduce((a, b) => a + b, 0);
    rate = recent.reduce((sum, row, i) => {
      const pgRate =
        row.gamesPlayed > 0 ? rowStat(row, target) / row.gamesPlayed : 0;
      return sum + pgRate * (weights[i] / totalW);
    }, 0);
    rate *= ageMult;

    if (eligible.length === 1) {
      const only = eligible[0];
      const lag1Rate =
        only.gamesPlayed > 0 ? rowStat(only, target) / only.gamesPlayed : 0;
      rate = lag1Rate * ageMult * 0.72 + rate * 0.28;
    }

    if (eligible.length < 3) {
      const xgRate = recent.reduce((sum, row, i) => {
        const xgPg =
          row.gamesPlayed > 0 ? (row.xGoals ?? 0) / row.gamesPlayed : 0;
        return sum + xgPg * (weights[i] / totalW);
      }, 0);
      if (target === "goals" && xgRate > 0) {
        rate = rate * 0.45 + xgRate * 0.55;
      }
      if (target === "assists" && xgRate > 0) {
        const ptsRate = recent.reduce((sum, row, i) => {
          const ptsPg =
            row.gamesPlayed > 0
              ? ((row.points ?? row.goals + row.assists) / row.gamesPlayed) *
                0.62
              : 0;
          return sum + ptsPg * (weights[i] / totalW);
        }, 0);
        rate = rate * 0.4 + ptsRate * 0.6;
      }
      if (target === "shots") {
        const satRate = recent.reduce((sum, row, i) => {
          const s =
            row.gamesPlayed > 0
              ? (row.totalShotAttempts ?? row.shots * 1.08) / row.gamesPlayed
              : 0;
          return sum + s * (weights[i] / totalW);
        }, 0);
        if (satRate > 0) rate = rate * 0.55 + satRate * 0.45;
      }
      if (target === "powerplayPoints") {
        const ppRate = recent.reduce((sum, row, i) => {
          const pp =
            row.gamesPlayed > 0
              ? (row.ppGoalsPer60 ?? 0) * (row.ppToiPerGame ?? 1) / 60
              : 0;
          return sum + pp * (weights[i] / totalW);
        }, 0);
        if (ppRate > 0) rate = rate * 0.5 + ppRate * 0.5;
      }
    }
  }

  const baseline = rookieRatePerGame(targetSeason.position, target);
  const contextualPrior = baseline * draftMult * ageMult;

  if (eligible.length < 2) {
    const experienceWeight = Math.min(1, eligible.length / 2);
    rate = rate * experienceWeight + contextualPrior * (1 - experienceWeight);
  } else {
    rate *= Math.max(0.97, Math.min(1.08, draftMult));
  }

  if (VOLATILE_LOW_HISTORY_TARGETS.has(target)) {
    const priorStrength =
      eligible.length === 0 ? 2.8 : eligible.length === 1 ? 2.0 : 1.3;
    rate = empiricalBayesShrink(rate, contextualPrior, eligible.length, priorStrength);
  }

  if (target === "penaltyMinutes") {
    const teamPim = targetSeason.teamPimPerGame ?? LEAGUE_TEAM_PIM_PG;
    const teamMult = Math.max(
      0.85,
      Math.min(1.2, 1 + ((teamPim - LEAGUE_TEAM_PIM_PG) / LEAGUE_TEAM_PIM_PG) * 0.35),
    );
    const penTaken = eligible.at(-1)?.penaltiesTakenPer60 ?? 0;
    if (penTaken > 0 && eligible.length <= 2) {
      const toi = eligible.at(-1)?.toiPerGame ?? 15;
      const penRate = (penTaken * toi) / 60;
      rate = rate * 0.55 + penRate * 0.45;
    }
    rate *= teamMult;
    if (posGroup === "D") rate *= 1.08;
  }

  if (target === "hits") {
    const teamHits = targetSeason.teamHitsPerGame ?? LEAGUE_TEAM_HITS_PG;
    const teamMult = Math.max(
      0.88,
      Math.min(1.15, 1 + ((teamHits - LEAGUE_TEAM_HITS_PG) / LEAGUE_TEAM_HITS_PG) * 0.25),
    );
    const hits60 = eligible.at(-1)?.hitsPer60 ?? 0;
    if (hits60 > 0 && eligible.length <= 2) {
      const toi = eligible.at(-1)?.toiPerGame ?? 15;
      rate = rate * 0.5 + ((hits60 * toi) / 60) * 0.5;
    }
    rate *= teamMult;
    if (posGroup === "D") rate *= 1.05;
  }

  if (eligible.length > 0 && eligible.length < 3) {
    const last = eligible[eligible.length - 1];
    const prev = eligible.length >= 2 ? eligible[eligible.length - 2] : null;
    if (prev && target !== "faceoffWins") {
      const lastVal = rowStat(last, target === "assists" ? "points" : target);
      const prevVal = rowStat(prev, target === "assists" ? "points" : target);
      const lastRate = last.gamesPlayed > 0 ? lastVal / last.gamesPlayed : 0;
      const prevRate = prev.gamesPlayed > 0 ? prevVal / prev.gamesPlayed : 0;
      if (prevRate > 0) {
        const trend = Math.max(
          0.88,
          Math.min(1.12, 1 + ((lastRate - prevRate) / prevRate) * 0.3),
        );
        rate *= trend;
      }
    }
    const sat = last?.satFor60 ?? last?.shotsFor60 ?? 0;
    if (
      sat > 0 &&
      ["goals", "assists", "shots", "powerplayPoints"].includes(target)
    ) {
      rate *= Math.min(1.1, 1 + sat / 120);
    }
  }

  if (target === "faceoffWins" && targetSeason.position !== "C") {
    return 0;
  }

  return Math.max(0, rate);
}
