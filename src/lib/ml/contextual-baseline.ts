import { rookieSkaterProjection } from "../projections";
import {
  depthOpportunityMult,
  lookupTeamDepth,
  type TeamDepthContext,
} from "./team-depth";
import { lookupProspectRates } from "../prospect-stats";
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
const LEAGUE_TEAM_GF_PG = 3.05;
const LEAGUE_F_TOI_PG = 16.5;
const LEAGUE_D_TOI_PG = 21.5;
const LEAGUE_PP_TOI_PG = 2.8;

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
  if (age >= 36) return 0.84;
  if (age >= 33) return 0.91;
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
  depth?: TeamDepthContext,
): number {
  const depthCtx =
    depth ?? lookupTeamDepth(targetSeason.seasonId, targetSeason.playerId);
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
              ? (row.ppPointsPer60 ?? 0) * (row.ppToiPerGame ?? 1) / 60
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
      target === "goals"
        ? eligible.length === 0
          ? 4.5
          : eligible.length === 1
            ? 3.2
            : 1.8
        : target === "assists"
          ? eligible.length === 0
            ? 3.8
            : eligible.length === 1
              ? 2.6
              : 1.4
          : eligible.length === 0
            ? 3.5
            : eligible.length === 1
              ? 2.4
              : 1.4;
    rate = empiricalBayesShrink(rate, contextualPrior, eligible.length, priorStrength);
  }

  if (eligible.length < 3) {
    // Pass the target season as cutoff: on historical training examples the
    // blend must not see prospect seasons that postdate the target.
    const prospect = lookupProspectRates(
      targetSeason.playerId,
      targetSeason.seasonId,
    );
    if (prospect) {
      const w = eligible.length === 0 ? 0.5 : eligible.length === 1 ? 0.35 : 0.2;
      if (target === "goals") {
        rate = rate * (1 - w) + prospect.goalsPerGame * w;
      } else if (target === "assists") {
        rate = rate * (1 - w) + prospect.assistsPerGame * w;
      } else if (target === "shots") {
        rate = rate * (1 - w) + prospect.shotsPerGame * w;
      } else if (target === "penaltyMinutes") {
        rate = rate * (1 - w * 0.6) + prospect.pimPerGame * w * 0.6;
      }
    }
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

    const toiBaseline = posGroup === "D" ? LEAGUE_D_TOI_PG : LEAGUE_F_TOI_PG;
    // Only prior-season TOI — the target season's own TOI is a future outcome.
    const toi = last?.toiPerGame ?? 0;
    if (toi > 0 && (target === "goals" || target === "assists")) {
      const toiMult = Math.max(
        0.82,
        Math.min(1.18, 1 + ((toi - toiBaseline) / toiBaseline) * 0.4),
      );
      rate *= toiMult;
    }

    if (target === "goals") {
      const ppToi = last?.ppToiPerGame ?? 0;
      if (ppToi > 0) {
        rate *= Math.min(
          1.14,
          1 + ((ppToi - LEAGUE_PP_TOI_PG) / LEAGUE_PP_TOI_PG) * 0.28,
        );
      }
      const shotsPg =
        last && last.gamesPlayed > 0
          ? (last.shots ?? 0) / last.gamesPlayed
          : 0;
      if (shotsPg > 0) {
        const shotGoalRate =
          shotsPg * (posGroup === "D" ? 0.075 : 0.11);
        if (eligible.length < 2) {
          rate = rate * 0.55 + shotGoalRate * 0.45;
        } else {
          rate = rate * 0.75 + shotGoalRate * 0.25;
        }
      }
      const teamGf = targetSeason.teamGoalsForPerGame ?? LEAGUE_TEAM_GF_PG;
      rate *= Math.max(
        0.9,
        Math.min(1.12, 1 + ((teamGf - LEAGUE_TEAM_GF_PG) / LEAGUE_TEAM_GF_PG) * 0.22),
      );
    }

    if (target === "assists") {
      const ppPts60 = last?.ppPointsPer60 ?? 0;
      const ppToi = last?.ppToiPerGame ?? 0;
      if (ppPts60 > 0 && ppToi > 0 && eligible.length < 2) {
        const ppAssistRate = ((ppPts60 * ppToi) / 60) * 0.55;
        rate = rate * 0.75 + ppAssistRate * 0.25;
      }
    }
  }

  if (target === "faceoffWins" && targetSeason.position !== "C") {
    return 0;
  }

  const nhlSeasons = eligible.length;
  if (nhlSeasons < 3) {
    rate *= depthOpportunityMult(
      depthCtx,
      targetSeason.draftOverallPick ?? 0,
      age,
      target,
    );
  }

  return Math.max(0, rate);
}

const YOUNG_ANCHOR_WEIGHTS: Partial<Record<string, number>> = {
  goals: 0.12,
  assists: 0.08,
  shots: 0.08,
};

/** Blend cohort/usage contextual anchor into young scoring rates at inference. */
export function anchorYoungScoringRate(
  target: string,
  priorSeasons: number,
  rate: number,
  contextual: number,
): number {
  if (priorSeasons > 2) return rate;
  const base = YOUNG_ANCHOR_WEIGHTS[target];
  if (!base) return rate;
  const tierMult = priorSeasons === 0 ? 1.3 : priorSeasons === 1 ? 1.1 : 1;
  const w = Math.min(0.3, base * tierMult);
  return rate * (1 - w) + contextual * w;
}
