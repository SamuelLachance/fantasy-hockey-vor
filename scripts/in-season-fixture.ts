/**
 * Frozen sample of the day-by-day skater backtest (scripts/backtest-in-season.ts
 * --write → src/data/ml/in-season-fixture.json): every 15th player-season
 * of 2021-22 → 2025-26 (walk-forward v2 priors) at three checkpoints, with
 * what was known that day (box stats, ice time, PP time, team games he
 * dressed for) and the rest of his season. The CI guard
 * (scripts/test-in-season.ts) re-scores it with the code as it stands — no
 * network, no cache — so a change to src/lib/inseason/skater.ts that loses
 * accuracy fails even when its constants did not move.
 */
import { shrinkRate, SKATER_RATE_K, SKATER_SHARE_K, updatedGameShare } from "../src/lib/in-season";
import { gamesShareNow, restOfSeasonRates, USAGE_STATS, usageNow, type UsageStat } from "../src/lib/inseason/skater";

export const FIXTURE_CHECKPOINTS = [5, 20, 40];
export const FIXTURE_EVERY = 15;
/** Slapshot skater points (G 3.5, A 2.5, PPP 0.5, SOG 0.25, HIT 0.15, BLK 0.3). */
const SLAPSHOT: Partial<Record<UsageStat, number>> = { goals: 3.5, assists: 2.5, powerplayPoints: 0.5, shots: 0.25, hits: 0.15, blocks: 0.3 };

export interface FixtureCheckpoint {
  T: number;
  /** His team's games left. */
  left: number;
  /** His games so far: the first `gp` entries of the player's toi / pp. */
  gp: number;
  /** His team's games so far: 1 where he dressed. */
  played: string;
  /** Totals so far and over the rest of the season (USAGE_STATS order). */
  tot: number[];
  rest: number[];
  restGp: number;
}
export interface FixturePlayer {
  key: string;
  /** Pre-season per-game rates (USAGE_STATS order), games share, ice time and PP time per game before the season. */
  prior: number[];
  share: number;
  toiPrior: number | null;
  ppPrior: number | null;
  toi: number[];
  pp: number[];
  cks: FixtureCheckpoint[];
}
export interface Fixture {
  stats: readonly string[];
  players: FixturePlayer[];
  /** Rest-of-season Slapshot RMSE when written. */
  expected: { cur: number; new: number };
}

const toStats = (v: readonly number[]) => Object.fromEntries(USAGE_STATS.map((s, i) => [s, v[i] ?? 0])) as Record<UsageStat, number>;
const slap = (x: Record<UsageStat, number>) => Object.entries(SLAPSHOT).reduce((t, [k, w]) => t + (w as number) * x[k as UsageStat], 0);

/** Rest-of-season Slapshot RMSE of the published box-stat update (`cur`) and of the usage-aware one (`new`). */
export function scoreFixture(players: readonly FixturePlayer[]): { cur: number; new: number; n: number } {
  let sc = 0, sn = 0, n = 0;
  for (const p of players) {
    const prior = toStats(p.prior);
    for (const c of p.cks) {
      const totals = toStats(c.tot);
      const actual = slap(toStats(c.rest));
      const usage = usageNow({ toiPrior: p.toiPrior, ppPrior: p.ppPrior, toi: p.toi.slice(0, c.gp), pp: p.pp.slice(0, c.gp) });
      const played = [...c.played].map((x) => x === "1");
      const rNew = restOfSeasonRates({ prior, totals, gp: c.gp, usage });
      const gNew = gamesShareNow(p.share, played, usage) * c.left;
      const rCur = Object.fromEntries(USAGE_STATS.map((s) => [s, shrinkRate(prior[s], SKATER_RATE_K[s]!, totals[s], c.gp)])) as Record<UsageStat, number>;
      const gCur = updatedGameShare(p.share, c.gp, c.T, SKATER_SHARE_K) * c.left;
      sn += (slap(rNew) * gNew - actual) ** 2;
      sc += (slap(rCur) * gCur - actual) ** 2;
      n++;
    }
  }
  return { cur: Math.sqrt(sc / Math.max(1, n)), new: Math.sqrt(sn / Math.max(1, n)), n };
}
