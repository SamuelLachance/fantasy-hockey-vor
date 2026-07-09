import {
  estimateShrunkGoalieSkill,
  goalieSkillWinMultiplier,
  LEAGUE_GA_PER_GAME,
  LEAGUE_SV_PCT,
  projectGoalieSaveStats,
} from "../goalie-skill";
import { ML_MIN_SEASON_GP } from "../nhl-api";
import type { SeasonHistory } from "../profile-types";
import type { TrainingExample } from "./features";
import { predictTwoStepGpFromExample } from "./gp-two-step";
import { evaluateRegression } from "./ridge";
import type {
  GpTwoStepConfig,
  ModelMetrics,
  PlayerSeasonRow,
  RidgeModel,
} from "./types";

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];
const LEAGUE_WIN_RATE = 0.45;
const LEAGUE_SHUTOUT_RATE = 0.04;
const MAX_WIN_RATE = 0.62;

function rowToSeasonHistory(row: PlayerSeasonRow): SeasonHistory {
  const sv = row.savePct > 1 ? row.savePct / 100 : row.savePct;
  const shotsAgainst =
    row.saves > 0 && sv > 0 ? Math.round(row.saves / sv) : Math.round(row.saves / LEAGUE_SV_PCT);
  return {
    season: String(row.seasonId),
    seasonId: row.seasonId,
    team: row.team,
    gamesPlayed: row.gamesPlayed,
    isGoalie: true,
    stats: {
      wins: row.wins,
      shutouts: row.shutouts,
      saves: row.saves,
      savePct: sv,
      shotsAgainst,
      goalsAgainst: Math.max(0, shotsAgainst - row.saves),
    },
    advanced: {},
  };
}

function weightedRate(
  seasons: SeasonHistory[],
  totalFn: (s: SeasonHistory) => number,
): number {
  const eligible = seasons.filter((s) => s.gamesPlayed >= ML_MIN_SEASON_GP);
  if (eligible.length === 0) return 0;
  const recent = eligible.slice(-3);
  const weights = EWMA_WEIGHTS.slice(-recent.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return recent.reduce((sum, s, i) => {
    const rate = s.gamesPlayed > 0 ? totalFn(s) / s.gamesPlayed : 0;
    return sum + rate * (weights[i] / totalW);
  }, 0);
}

/** EWMA of values that are already per-game rates (e.g. save%). */
function weightedRateAverage(
  seasons: SeasonHistory[],
  rateFn: (s: SeasonHistory) => number,
): number {
  const eligible = seasons.filter((s) => s.gamesPlayed >= ML_MIN_SEASON_GP);
  if (eligible.length === 0) return 0;
  const recent = eligible.slice(-3);
  const weights = EWMA_WEIGHTS.slice(-recent.length);
  const totalW = weights.reduce((a, b) => a + b, 0);
  return recent.reduce(
    (sum, s, i) => sum + rateFn(s) * (weights[i] / totalW),
    0,
  );
}

function goalieAgeMult(age: number): number {
  if (age >= 37) return 0.82;
  if (age >= 34) return 0.9;
  if (age <= 25) return 1.03;
  return 1;
}

export interface GoalieProductionRates {
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
}

/** Mirror production goalie path for holdout evaluation from dataset rows. */
export function projectGoalieRatesFromRows(
  prior: PlayerSeasonRow[],
  targetRow: PlayerSeasonRow,
  projectedGp: number,
): GoalieProductionRates {
  const seasons = prior.filter((r) => r.isGoalie).map(rowToSeasonHistory);
  const teamGa = targetRow.teamGoalsAgainstPerGame ?? 2.85;
  const teamWinPct = targetRow.teamPointPctg ?? 0.5;
  const teamGf = targetRow.teamGoalsForPerGame ?? 3.05;
  const age = targetRow.age ?? 28;
  const ageMult = goalieAgeMult(age);
  const teamBoost = 0.85 + teamWinPct * 0.3;
  const defEnvBoost = Math.max(
    0.9,
    Math.min(1.1, 1 + (LEAGUE_GA_PER_GAME - teamGa) * 0.06),
  );
  const pythWinRate = Math.max(
    0.35,
    Math.min(0.65, 0.5 + (teamGf - teamGa) * 0.11),
  );

  const skill = estimateShrunkGoalieSkill(targetRow.playerId, seasons, teamGa);
  const skillWinMult = goalieSkillWinMultiplier(skill, teamGa);

  const ewmaWinRate = weightedRate(seasons, (s) => s.stats.wins ?? 0);
  const ewmaShutoutRate = weightedRate(seasons, (s) => s.stats.shutouts ?? 0);
  const ewmaSavePct = weightedRateAverage(seasons, (s) => {
    const sv = s.stats.savePct ?? LEAGUE_SV_PCT;
    return sv > 1 ? sv / 100 : sv > 0 ? sv : LEAGUE_SV_PCT;
  });
  const ewmaSavesRate = weightedRate(seasons, (s) => s.stats.saves ?? 0);

  let winRate =
    ewmaWinRate > 0
      ? ewmaWinRate
      : skill.winRate > 0
        ? skill.winRate
        : LEAGUE_WIN_RATE;
  winRate = Math.min(MAX_WIN_RATE, winRate * ageMult * teamBoost * defEnvBoost * skillWinMult);
  winRate = winRate * 0.72 + pythWinRate * skillWinMult * 0.28;
  winRate = Math.min(MAX_WIN_RATE, winRate);

  let shutoutRate =
    ewmaShutoutRate > 0
      ? ewmaShutoutRate
      : skill.shutoutRate > 0
        ? skill.shutoutRate
        : LEAGUE_SHUTOUT_RATE;
  shutoutRate *= ageMult;
  if (skill.gsaxPerGame > 0) {
    shutoutRate *= Math.min(1.2, 1 + skill.gsaxPerGame * 0.08);
  } else if (skill.gsaxPerGame < 0) {
    shutoutRate *= Math.max(0.8, 1 + skill.gsaxPerGame * 0.06);
  }

  const { saves: skillSaves, savePct: skillSv } = projectGoalieSaveStats(
    skill,
    Math.max(1, projectedGp),
  );

  const savePct =
    ewmaSavePct > 0
      ? ewmaSavePct * 0.55 + skillSv * 0.45
      : skillSv;
  const savesPerGame =
    ewmaSavesRate > 0
      ? ewmaSavesRate * 0.6 + (skillSaves / Math.max(1, projectedGp)) * 0.4
      : skillSaves / Math.max(1, projectedGp);

  return {
    wins: winRate,
    shutouts: shutoutRate,
    saves: savesPerGame,
    savePct,
  };
}

export function actualGoalieRates(row: PlayerSeasonRow): GoalieProductionRates {
  const gp = Math.max(1, row.gamesPlayed);
  return {
    wins: row.wins / gp,
    shutouts: row.shutouts / gp,
    saves: row.saves / gp,
    savePct: row.savePct > 1 ? row.savePct / 100 : row.savePct,
  };
}

function priorHistoryForExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  example: TrainingExample,
): PlayerSeasonRow[] {
  const history = historyMap.get(example.playerId) ?? [];
  const idx = history.findIndex((r) => r.seasonId === example.seasonId);
  return idx > 0 ? history.slice(0, idx) : [];
}

/** Holdout metrics for the GSAx production path (what ships on the site). */
export function evaluateGoalieProductionHoldout(
  holdout: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  gpModel: RidgeModel,
  twoStepConfig: GpTwoStepConfig,
  injuryGpFn: (prior: PlayerSeasonRow[], target: PlayerSeasonRow) => number,
): Record<string, ModelMetrics> {
  const stats = ["wins", "shutouts", "saves", "savePct"] as const;
  const result: Record<string, ModelMetrics> = {};

  for (const stat of stats) {
    const y = holdout.map((ex) => {
      const row = ex.targetSeason;
      if (stat === "savePct") {
        return row.savePct > 1 ? row.savePct / 100 : row.savePct;
      }
      return (row as unknown as Record<string, number>)[stat] / Math.max(1, row.gamesPlayed);
    });
    const preds = holdout.map((ex) => {
      const prior = priorHistoryForExample(historyMap, ex);
      const gp = predictTwoStepGpFromExample(
        ex,
        prior,
        gpModel,
        twoStepConfig,
        true,
        injuryGpFn(prior, ex.targetSeason),
      );
      return projectGoalieRatesFromRows(prior, ex.targetSeason, gp)[stat];
    });
    result[stat] = evaluateRegression(y, preds);
  }

  return result;
}
