/**
 * The share of a bench player's season points that still count in a daily-
 * lineup league without games caps (Slapshot: he plays when a starter at his
 * seat is idle), fitted by `scripts/backtest-trade.ts` on the 2022-23 NHL
 * season replayed day by day (the seasons it scores never saw it). Captains
 * caps the games a team's active players may log (52 skater games and 8
 * goalie starts a week), so its bench plays less: `CAPPED_BENCH_SHARE`, a
 * prior (the cap leaves about 6 games a week to the bench over 13 skaters
 * ≈ 3.5 games each), not fitted.
 */
export const TRADE_BENCH = {
  benchShare: 0.7,
  cappedBenchShare: 0.15,
  goalieBenchShare: 0.25,
};
