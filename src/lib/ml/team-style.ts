import type { PlayerSeasonRow } from "./types";
import { teamSeasonKey } from "./context-types";

export interface TeamStyleContext {
  hitsPerGame: number;
  pimPerGame: number;
  blocksPerGame: number;
  ppGoalShare: number;
  pkGoalsAgainstPer60: number;
}

/** Aggregate team physicality / special-teams style from skater season rows. */
export function buildTeamStyleBySeasonTeam(
  rows: PlayerSeasonRow[],
): Map<string, TeamStyleContext> {
  const buckets = new Map<
    string,
    { hits: number; pim: number; blocks: number; gp: number; ppGoals: number; evGoals: number; shGa: number; shToi: number }
  >();

  for (const row of rows) {
    if (row.isGoalie || row.gamesPlayed < 5) continue;
    const team = row.team.split(",")[0].trim().toUpperCase();
    const key = teamSeasonKey(row.seasonId, team);
    const b = buckets.get(key) ?? {
      hits: 0,
      pim: 0,
      blocks: 0,
      gp: 0,
      ppGoals: 0,
      evGoals: 0,
      shGa: 0,
      shToi: 0,
    };
    b.hits += row.hits;
    b.pim += row.penaltyMinutes;
    b.blocks += row.blocks;
    b.gp += row.gamesPlayed;
    b.ppGoals += row.ppGoals ?? 0;
    b.evGoals += row.evGoals ?? 0;
    const shToi = (row.shToiPerGame ?? 0) * row.gamesPlayed;
    b.shToi += shToi;
    // KNOWN DEFECT (needs paired dataset rebuild + retrain to change):
    // shGoalsPer60 is the skater's shorthanded goals SCORED per 60, not
    // on-ice PK goals against, so pkGoalsAgainstPer60 lands around 0.1-0.6 —
    // roughly 10x below the 2.5 missing-data default. Training and inference
    // currently see the feature computed identically, so correcting the
    // source (e.g. the goalsForAgainst report) or the default without
    // retraining the committed bundle would skew inference. Fix at the next
    // full retrain.
    b.shGa += (row.shGoalsPer60 ?? 0) * (shToi / 60);
    buckets.set(key, b);
  }

  const out = new Map<string, TeamStyleContext>();
  for (const [key, b] of buckets) {
    const teamGames = Math.max(1, b.gp / 18);
    const totalGoals = b.ppGoals + b.evGoals;
    out.set(key, {
      hitsPerGame: b.hits / teamGames,
      pimPerGame: b.pim / teamGames,
      blocksPerGame: b.blocks / teamGames,
      ppGoalShare: totalGoals > 0 ? b.ppGoals / totalGoals : 0.2,
      pkGoalsAgainstPer60: b.shToi > 0 ? (b.shGa / b.shToi) * 60 : 2.5,
    });
  }
  return out;
}

export function yearsOnCurrentTeam(history: PlayerSeasonRow[]): number {
  if (history.length === 0) return 0;
  const current = history[history.length - 1]?.team.split(",")[0].trim().toUpperCase();
  let years = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const team = history[i].team.split(",")[0].trim().toUpperCase();
    if (team !== current) break;
    if (history[i].gamesPlayed >= 10) years++;
  }
  return years;
}

export function teamChangedFlag(history: PlayerSeasonRow[]): number {
  const eligible = history.filter((h) => h.gamesPlayed >= 10);
  if (eligible.length < 2) return 0;
  const last = eligible[eligible.length - 1].team.split(",")[0].trim().toUpperCase();
  const prev = eligible[eligible.length - 2].team.split(",")[0].trim().toUpperCase();
  return last !== prev ? 1 : 0;
}
