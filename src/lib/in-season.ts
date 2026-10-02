/**
 * Pure rules of the daily in-season update (scripts/update-in-season.ts),
 * kept here so they are unit-tested (scripts/test-in-season.ts) and
 * backtested with the same code that runs.
 *
 * Every constant below was chosen on 2021-22 → 2025-26 game-by-game data
 * (walk-forward v2 pre-season priors, rest-of-season RMSE at the 5th, 10th,
 * 20th and 40th team game; audit of 2026-10-02):
 * - per-stat rate K: optimum of each stat (FOW 8, hits 18, PPP 46, …);
 * - games share K: the pre-season share of team games is itself updated by
 *   the games played (K 30 team games for skaters, 18 for goalies);
 * - goalies: shots against per game K 15, shutouts K 100;
 * - a hurt goalie's missing starts go first to the healthy n° 2 (61 % of
 *   them historically), the rest to the others by their usual share.
 */

/** Team games before a stat's season rate weighs as much as the pre-season one. */
export const SKATER_RATE_K: Readonly<Record<string, number>> = {
  goals: 80,
  assists: 65,
  powerplayPoints: 50,
  shots: 28,
  hits: 20,
  blocks: 40,
  penaltyMinutes: 120,
  faceoffWins: 10,
};

/** Team games before the season's games share weighs as much as the pre-season one. */
export const SKATER_SHARE_K = 30;
export const GOALIE_SHARE_K = 18;

/** Goalie shrinkage: games for wins, shutouts and shots against, shots for SV%. */
export const GOALIE_K = { wins: 30, shutouts: 100, shotsAgainstPerGame: 15, savePctShots: 1500 } as const;

/** Most of a stretch of games one goalie starts. */
export const GOALIE_MAX_SHARE = 0.8;
/** Share of a hurt goalie's missing starts the healthy n° 2 takes. */
export const BACKUP_TAKES = 0.6;

/**
 * Newcomers (a player with NHL games this season but no pre-season
 * projection, mostly call-ups and rookies): per-82 prior of a first NHL
 * season, forwards and defensemen, 2015-16 → 2025-26.
 */
export const NEWCOMER_PER82: Readonly<Record<"F" | "D", Readonly<Record<string, number>>>> = {
  F: { goals: 12.3, assists: 16.1, powerplayPoints: 5.0, shots: 113, hits: 94, blocks: 36, penaltyMinutes: 33, faceoffWins: 98 },
  D: { goals: 4.9, assists: 16.2, powerplayPoints: 4.4, shots: 91, hits: 96, blocks: 93, penaltyMinutes: 40, faceoffWins: 0 },
};
/** A newcomer's rates speak for themselves sooner than a veteran's. */
export const NEWCOMER_RATE_K = 10;
/** Newcomer games share: prior 0.4 of his team's games since his debut. */
export const NEWCOMER_SHARE_PRIOR = 0.4;
export const NEWCOMER_SHARE_K = 10;
/** A newcomer goalie: per-game prior of a call-up goalie. */
export const NEWCOMER_GOALIE = { wins: 0.42, shutouts: 0.04, shotsAgainstPerGame: 27, savePct: 0.898, share: 0.2 } as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** (prior × K + season total) / (K + games): the season rate shrunk toward the prior. */
export function shrinkRate(priorPerGame: number, k: number, seasonTotal: number, games: number): number {
  const d = k + Math.max(0, games);
  return d > 0 ? (priorPerGame * k + seasonTotal) / d : priorPerGame;
}

/**
 * Expected share of his team's remaining games: the pre-season share
 * updated by the games he played out of his team's games so far.
 * `teamGames` should leave out the games of a CURRENT absence (they are
 * already taken out of his remaining games by the injury).
 */
export function updatedGameShare(priorShare: number, gp: number, teamGames: number, k: number): number {
  const tg = Math.max(0, teamGames);
  const g = Math.max(0, Math.min(gp, tg));
  return clamp01((clamp01(priorShare) * k + g) / (k + tg));
}

/**
 * Team games still to miss when the report gives no return date. The
 * expected rest of an absence grows with what it has already lasted
 * (11,444 NHL absences, 2021-26): ~7 games after 0-2 missed, 10 after 3-5,
 * 12 after 6-12, 14 beyond. Day-to-day: 1. Suspension: 3.
 */
export function defaultGamesOut(status: string, gamesMissedSoFar: number | null): number {
  if (status === "Day-To-Day") return 1;
  if (status === "Suspension") return 3;
  const e = gamesMissedSoFar ?? 0;
  if (e <= 2) return 7;
  if (e <= 5) return 10;
  if (e <= 12) return 12;
  return 14;
}

export interface GoalieSlot {
  id: number;
  /** Expected share of the team's games (updated). */
  share: number;
  /** Team games he will miss (0 = available, a day-to-day without a game missed included). */
  gamesOut: number;
}

/**
 * Starts a team's hurt goalies will miss, handed to the healthy ones: the
 * healthy goalie with the largest share (the n° 2 when the starter is hurt)
 * takes BACKUP_TAKES of them, up to GOALIE_MAX_SHARE of the absence window;
 * the others share the rest in proportion to their usual share (not to how
 * much room they have: the deepest goalie of the pool used to get the most).
 * Returns the extra starts per goalie id.
 */
export function redistributeGoalieStarts(team: GoalieSlot[], left: number): Map<number, number> {
  const extra = new Map<number, number>();
  if (!(left > 0)) return extra;
  const healthy = team.filter((g) => !(g.gamesOut > 0)).sort((a, b) => b.share - a.share || a.id - b.id);
  if (healthy.length === 0) return extra;
  const added = new Map<number, number>();
  const room = (g: GoalieSlot, window: number) =>
    Math.max(0, GOALIE_MAX_SHARE * window - clamp01(g.share) * window - (added.get(g.id) ?? 0));
  const give = (g: GoalieSlot, n: number) => {
    if (!(n > 0)) return;
    added.set(g.id, (added.get(g.id) ?? 0) + n);
    extra.set(g.id, (extra.get(g.id) ?? 0) + n);
  };
  for (const hurt of team.filter((g) => g.gamesOut > 0).sort((a, b) => b.share - a.share || a.id - b.id)) {
    const window = Math.min(hurt.gamesOut, left);
    const missing = window * clamp01(hurt.share);
    if (!(missing > 0)) continue;
    const [first, ...others] = healthy;
    const toFirst = Math.min(BACKUP_TAKES * missing, room(first, window));
    give(first, toFirst);
    // What the n° 2 cannot take (his cap) goes to the others too.
    const rest = missing - toFirst;
    const total = others.reduce((s, g) => s + clamp01(g.share), 0);
    if (!(total > 0)) continue;
    for (const g of others) give(g, Math.min((rest * clamp01(g.share)) / total, room(g, window)));
  }
  return extra;
}
