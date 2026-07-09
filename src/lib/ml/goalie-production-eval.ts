import {
  estimateShrunkGoalieSkill,
  LEAGUE_SV_PCT,
} from "../goalie-skill";
import {
  projectedGoalieGpLag1TeamNormFromRows,
  projectGoalieLag1Totals,
} from "../goalie-projection";
import type { TrainingExample } from "./features";
import { evaluateRegression } from "./ridge";
import type { ModelMetrics, PlayerSeasonRow } from "./types";

export interface GoalieProductionRates {
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
}

/** Production goalie rates: lag1 persistence (validated on 2024-25 holdout). */
export function projectGoalieRatesFromRows(
  prior: PlayerSeasonRow[],
  _targetRow: PlayerSeasonRow,
  projectedGp: number,
): GoalieProductionRates {
  const rates = goalieLag1Rates(prior);
  const skill = estimateShrunkGoalieSkill(
    _targetRow.playerId,
    prior
      .filter((r) => r.isGoalie)
      .map((row) => ({
        season: String(row.seasonId),
        seasonId: row.seasonId,
        team: row.team,
        gamesPlayed: row.gamesPlayed,
        isGoalie: true as const,
        stats: {
          wins: row.wins,
          shutouts: row.shutouts,
          saves: row.saves,
          savePct: row.savePct > 1 ? row.savePct / 100 : row.savePct,
          shotsAgainst: 0,
          goalsAgainst: 0,
        },
        advanced: {},
      })),
    _targetRow.teamGoalsAgainstPerGame ?? 2.85,
  );
  const savePct =
    rates.savePct * 0.55 + (skill.savePct || LEAGUE_SV_PCT) * 0.45;
  void projectedGp;
  return {
    wins: rates.wins,
    shutouts: rates.shutouts,
    saves: rates.saves,
    savePct,
  };
}

export function projectGoalieTotalsFromRows(
  prior: PlayerSeasonRow[],
  gamesPlayed: number,
): ReturnType<typeof projectGoalieLag1Totals> {
  return projectGoalieLag1Totals(prior, gamesPlayed);
}

function priorHistoryForExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  example: TrainingExample,
): PlayerSeasonRow[] {
  const history = historyMap.get(example.playerId) ?? [];
  const idx = history.findIndex((r) => r.seasonId === example.seasonId);
  return idx > 0 ? history.slice(0, idx) : [];
}

/** Holdout metrics for lag1 goalie production path (what ships on the site). */
export function evaluateGoalieProductionHoldout(
  holdout: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  datasetRows: PlayerSeasonRow[],
): Record<string, ModelMetrics> {
  const stats = ["wins", "shutouts", "saves", "savePct"] as const;
  const result: Record<string, ModelMetrics> = {};

  for (const stat of stats) {
    const y = holdout.map((ex) => {
      const row = ex.targetSeason;
      if (stat === "savePct") {
        return row.savePct > 1 ? row.savePct / 100 : row.savePct;
      }
      return row[stat];
    });
    const preds = holdout.map((ex) => {
      const prior = priorHistoryForExample(historyMap, ex);
      const gp = projectedGoalieGpLag1TeamNormFromRows(
        ex.playerId,
        ex.targetSeason.team,
        ex.seasonId,
        datasetRows,
        historyMap,
      );
      const totals = projectGoalieLag1Totals(prior, gp);
      if (stat === "savePct") return totals.savePct;
      return totals[stat];
    });
    result[stat] = evaluateRegression(y, preds);
  }

  const gpY = holdout.map((ex) => ex.targetSeason.gamesPlayed);
  const gpPred = holdout.map((ex) =>
    projectedGoalieGpLag1TeamNormFromRows(
      ex.playerId,
      ex.targetSeason.team,
      ex.seasonId,
      datasetRows,
      historyMap,
    ),
  );
  result.gamesPlayed = evaluateRegression(gpY, gpPred);

  return result;
}
