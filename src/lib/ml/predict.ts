import type { PlayerProfile } from "../profile-types";
import { projectGoalieFromProfile } from "../contextual-projections";
import {
  anchorSkaterProjectionToHistory,
  clampSkaterProjection,
} from "../projection-sanity";
import { projectedGamesFromProfile } from "../projection-gp";
import type { GoalieProjection, SkaterProjection } from "../types";
import {
  buildTargetInferenceFeatures,
} from "./features";
import { predictRidge } from "./ridge";
import type { MlModelBundle, PlayerSeasonRow } from "./types";
import { loadMlModels } from "./train";

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];

function ewmaPerGameRate(
  history: PlayerSeasonRow[],
  stat: (row: PlayerSeasonRow) => number,
): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10).slice(-3);
  if (eligible.length === 0) return 0;
  const weights = EWMA_WEIGHTS.slice(-eligible.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return eligible.reduce((sum, row, i) => {
    const rate = row.gamesPlayed > 0 ? stat(row) / row.gamesPlayed : 0;
    return sum + rate * (weights[i] / totalW);
  }, 0);
}

function careerRate(profile: PlayerProfile, field: string): number {
  const gp = profile.careerTotals.gamesPlayed ?? 0;
  if (gp < 5) return 0;
  return Number(profile.careerTotals[field] ?? 0) / gp;
}

function anchorPerGameRate(
  target: string,
  ewma: number,
  ml: number,
  profile: PlayerProfile,
): number {
  const career = careerRate(profile, target === "powerplayPoints" ? "powerPlayPoints" : target === "penaltyMinutes" ? "pim" : target);

  if (ewma > 0) {
    return Math.max(0, ewma * 0.82 + ml * 0.18);
  }

  if (career > 0) {
    return Math.min(ml, career * 1.2);
  }

  if (target === "goals") {
    return profile.position === "D" ? 0.03 : 0.08;
  }
  if (target === "powerplayPoints") {
    return 0;
  }

  return Math.min(ml, ewma);
}

function profileToSeasonRows(profile: PlayerProfile): PlayerSeasonRow[] {
  return profile.teamHistory.map((s) => ({
    playerId: profile.id,
    name: profile.name,
    seasonId: s.seasonId,
    team: s.team,
    position: profile.position,
    isGoalie: s.isGoalie,
    gamesPlayed: s.gamesPlayed,
    goals: s.stats.goals ?? 0,
    assists: s.stats.assists ?? 0,
    shots: s.stats.shots ?? 0,
    blocks: s.advanced.blocks ?? 0,
    hits: s.advanced.hits ?? 0,
    powerplayPoints: s.stats.ppPoints ?? 0,
    penaltyMinutes: s.stats.pim ?? 0,
    faceoffWins: s.advanced.faceoffWins ?? 0,
    wins: s.stats.wins ?? 0,
    shutouts: s.stats.shutouts ?? 0,
    saves: s.stats.saves ?? 0,
    savePct: s.stats.savePct ?? 0.905,
    teamGoalsForPerGame: profile.teamContext.goalsForPerGame,
  }));
}

function rowStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

export function projectSkaterWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
): { projection: SkaterProjection; gamesPlayed: number; reasoning: string } {
  const history = profileToSeasonRows(profile).filter((r) => !r.isGoalie);
  const gamesPlayed = projectedGamesFromProfile(profile);

  const rates: Record<string, number> = {};
  for (const model of models.skaterModels) {
    const { features } = buildTargetInferenceFeatures(history, model.target, false);
    const ml = Math.max(0, predictRidge(model, features));
    const ewma = ewmaPerGameRate(history, (r) => rowStat(r, model.target));
    rates[model.target] = anchorPerGameRate(model.target, ewma, ml, profile);
  }

  const raw = clampSkaterProjection(
    {
      goals: Math.round(rates.goals * gamesPlayed),
      assists: Math.round(rates.assists * gamesPlayed),
      shots: Math.round(rates.shots * gamesPlayed),
      blocks: Math.round(rates.blocks * gamesPlayed),
      hits: Math.round(rates.hits * gamesPlayed),
      powerplayPoints: Math.round(rates.powerplayPoints * gamesPlayed),
      penaltyMinutes: Math.round(rates.penaltyMinutes * gamesPlayed),
      faceoffWins: Math.round(rates.faceoffWins * gamesPlayed),
    },
    gamesPlayed,
    profile.position,
  );

  const projection = anchorSkaterProjectionToHistory(profile, raw, gamesPlayed);

  const avgR2 =
    Object.values(models.metrics.skater).reduce((s, m) => s + m.r2, 0) /
    Object.keys(models.metrics.skater).length;

  return {
    projection,
    gamesPlayed,
    reasoning: `ML time-series (${models.featureLags}-season lags) anchored to career rates; ${gamesPlayed} GP based on durability`,
  };
}

export function projectGoalieWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const contextual = projectGoalieFromProfile(profile);

  const skaterAvgR2 =
    Object.values(models.metrics.skater).reduce((s, m) => s + m.r2, 0) /
    Object.keys(models.metrics.skater).length;

  return {
    ...contextual,
    reasoning: `Goalie EWMA from recent seasons (ML skater holdout R²≈${skaterAvgR2.toFixed(2)})`,
  };
}

export function getMlModels(): MlModelBundle | null {
  return loadMlModels();
}
