import type { PlayerProfile } from "../profile-types";
import {
  clampGoalieProjection,
  clampSkaterProjection,
} from "../projection-sanity";
import type { GoalieProjection, SkaterProjection } from "../types";
import {
  buildGoalieGpInferenceFeatures,
  buildTargetInferenceFeatures,
} from "./features";
import { predictRidge } from "./ridge";
import type { MlModelBundle, PlayerSeasonRow } from "./types";
import { loadMlModels } from "./train";

const FULL_SEASON_GP = 82;
const GOALIE_MIN_GP = 20;
const GOALIE_MAX_GP = 58;
const EWMA_WEIGHTS = [0.15, 0.3, 0.55];
const LEAGUE_GOALIE_RATES = {
  winRate: 0.45,
  shutoutRate: 0.04,
  savesPerGame: 26,
  savePct: 0.905,
};

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

function recentEwmaSavePct(history: PlayerSeasonRow[]): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10).slice(-3);
  if (eligible.length === 0) return LEAGUE_GOALIE_RATES.savePct;
  const weights = EWMA_WEIGHTS.slice(-eligible.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  let sum = 0;
  for (let i = 0; i < eligible.length; i++) {
    const raw = eligible[i].savePct;
    const pct = raw > 1 ? raw / 100 : raw;
    sum += pct * (weights[i] / totalW);
  }
  return sum;
}

function ewmaSeasonGp(history: PlayerSeasonRow[]): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10).slice(-3);
  if (eligible.length === 0) return 30;
  const weights = EWMA_WEIGHTS.slice(-eligible.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return eligible.reduce((sum, row, i) => sum + row.gamesPlayed * (weights[i] / totalW), 0);
}

function blendRate(ewma: number, ml: number, ewmaWeight = 0.7): number {
  const blended = ewma * ewmaWeight + ml * (1 - ewmaWeight);
  return Math.max(0, blended > 0 ? blended : ewma);
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
  const gamesPlayed = FULL_SEASON_GP;

  const rates: Record<string, number> = {};
  for (const model of models.skaterModels) {
    const { features } = buildTargetInferenceFeatures(history, model.target, false);
    const ml = Math.max(0, predictRidge(model, features));
    const ewma = ewmaPerGameRate(history, (r) => rowStat(r, model.target));
    rates[model.target] = ewma > 0 ? blendRate(ewma, ml, 0.72) : ml;
  }

  const projection = clampSkaterProjection(
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

  const avgR2 =
    Object.values(models.metrics.skater).reduce((s, m) => s + m.r2, 0) /
    Object.keys(models.metrics.skater).length;

  return {
    projection,
    gamesPlayed,
    reasoning: `ML time-series model (${models.featureLags}-season lags, 2010-2025 training, holdout R²≈${avgR2.toFixed(2)}); projected ${gamesPlayed} GP full season`,
  };
}

export function projectGoalieWithMl(
  profile: PlayerProfile,
  models: MlModelBundle,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const history = profileToSeasonRows(profile).filter((r) => r.isGoalie);
  const gpFeatures = buildGoalieGpInferenceFeatures(history).features;

  const mlGp = predictRidge(models.goalieGpModel, gpFeatures);
  const ewmaGp = ewmaSeasonGp(history);
  const gamesPlayed = Math.round(
    Math.min(
      GOALIE_MAX_GP,
      Math.max(GOALIE_MIN_GP, blendRate(ewmaGp || 30, mlGp, 0.55)),
    ),
  );

  const mlRates: Record<string, number> = {};
  for (const model of models.goalieModels) {
    const { features } = buildTargetInferenceFeatures(history, model.target, true);
    mlRates[model.target] = predictRidge(model, features);
  }

  const winRate = blendRate(
    ewmaPerGameRate(history, (r) => r.wins) || LEAGUE_GOALIE_RATES.winRate,
    mlRates.wins ?? 0,
  );
  const shutoutRate = blendRate(
    ewmaPerGameRate(history, (r) => r.shutouts) || LEAGUE_GOALIE_RATES.shutoutRate,
    mlRates.shutouts ?? 0,
  );
  const saveRate = blendRate(
    ewmaPerGameRate(history, (r) => r.saves) || LEAGUE_GOALIE_RATES.savesPerGame,
    mlRates.saves ?? 0,
  );
  const savePct = Math.max(
    0.875,
    Math.min(0.93, blendRate(recentEwmaSavePct(history), mlRates.savePct ?? 0.905, 0.85)),
  );

  const projection = clampGoalieProjection(
    {
      wins: Math.round(winRate * gamesPlayed),
      shutouts: Math.round(shutoutRate * gamesPlayed),
      saves: Math.round(saveRate * gamesPlayed),
      savePct,
    },
    gamesPlayed,
  );

  const skaterAvgR2 =
    Object.values(models.metrics.skater).reduce((s, m) => s + m.r2, 0) /
    Object.keys(models.metrics.skater).length;

  return {
    projection,
    gamesPlayed,
    reasoning: `ML time-series (16 seasons, skater holdout R²≈${skaterAvgR2.toFixed(2)}; goalie rates blended with EWMA); ${gamesPlayed} GP workload`,
  };
}

export function getMlModels(): MlModelBundle | null {
  return loadMlModels();
}
