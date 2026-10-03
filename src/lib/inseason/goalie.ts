/**
 * Rest-of-season rates and games share of a goalie in the daily in-season
 * update (scripts/update-in-season.ts; backtested by
 * scripts/backtest-in-season-goalies.ts).
 *
 * Games share: the pre-season share updated by the team games he played,
 * recent ones weighing more (a starter who lost the crease shows it in his
 * last games first). Rates: his own totals shrunk toward the prior; the
 * rule also takes his team's games another goalie played as evidence
 * (rate = (prior × K + his total + w × the others' total) / (K + his games
 * + w × the others' games)), a weight w the backtest keeps at 0 (see
 * GOALIE_RULES).
 */
import { recencyMean } from "./skater";

export interface GoalieRule {
  /** Prior weight in games (shots for save %). */
  k: number;
  /** Weight of a team game he did not play, against one of his own. */
  team: number;
}
export interface GoalieRules {
  wins: GoalieRule;
  shotsAgainst: GoalieRule;
  shutouts: GoalieRule;
  savePctShots: number;
  shareK: number;
  shareHalfLife: number;
}

/**
 * The published rules (src/lib/in-season.ts at bd259b2): every variant tried
 * on 2021-22 → 2025-26 (scripts/backtest-in-season-goalies.ts --variants /
 * --tune) failed to beat them season after season: counting the team's
 * other games for wins, shots against or shutouts improved each stat alone
 * yet lost on the season points in most seasons, and a recency-weighted
 * games share won 2 of 5 seasons out of sample. Nothing here is shipped;
 * the daily update keeps src/lib/in-season.ts for goalies.
 */
export const GOALIE_RULES: Readonly<GoalieRules> = {
  wins: { k: 30, team: 0 },
  shotsAgainst: { k: 15, team: 0 },
  shutouts: { k: 100, team: 0 },
  savePctShots: 1500,
  shareK: 18,
  shareHalfLife: 0,
};

export interface GoalieSeason {
  /** His games so far and totals. */
  gp: number;
  wins: number;
  shutouts: number;
  saves: number;
  shotsAgainst: number;
  /** The team's games he did not play (another goalie in net): count and totals. */
  otherGames: number;
  otherWins: number;
  otherShutouts: number;
  otherShotsAgainst: number;
}
export interface GoaliePrior {
  winsPerGame: number;
  shutoutsPerGame: number;
  shotsAgainstPerGame: number;
  savePct: number;
}
export interface GoalieRates {
  winsPerGame: number;
  shutoutsPerGame: number;
  shotsAgainstPerGame: number;
  savePct: number;
}

const blend = (prior: number, r: GoalieRule, own: number, ownGames: number, other: number, otherGames: number) => {
  const d = r.k + Math.max(0, ownGames) + r.team * Math.max(0, otherGames);
  return d > 0 ? (prior * r.k + Math.max(0, own) + r.team * Math.max(0, other)) / d : prior;
};

export function goalieRestRates(prior: GoaliePrior, s: GoalieSeason, rules: GoalieRules = GOALIE_RULES): GoalieRates {
  return {
    winsPerGame: blend(prior.winsPerGame, rules.wins, s.wins, s.gp, s.otherWins, s.otherGames),
    shutoutsPerGame: blend(prior.shutoutsPerGame, rules.shutouts, s.shutouts, s.gp, s.otherShutouts, s.otherGames),
    shotsAgainstPerGame: blend(prior.shotsAgainstPerGame, rules.shotsAgainst, s.shotsAgainst, s.gp, s.otherShotsAgainst, s.otherGames),
    savePct: (prior.savePct * rules.savePctShots + Math.max(0, s.saves)) / (rules.savePctShots + Math.max(0, s.shotsAgainst)),
  };
}

/** His share of the team's games from now on (played: the team's games so far, oldest first, current reported absence left out). */
export function goalieShareNow(priorShare: number, played: readonly boolean[], rules: GoalieRules = GOALIE_RULES): number {
  return Math.max(0, Math.min(1, recencyMean(Math.max(0, Math.min(1, priorShare)), played.map((x) => (x ? 1 : 0)), rules.shareK, rules.shareHalfLife)));
}
