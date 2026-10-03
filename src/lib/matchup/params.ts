/**
 * Distribution parameters of the weekly categories simulator, fitted on NHL
 * box scores by `scripts/backtest-matchup.ts --fit` (public NHL stats REST,
 * per game, regular seasons 2022-23 and 2023-24: the seasons BEFORE the ones
 * the backtest scores, so the scored weeks never saw them). Re-fit and paste
 * when the backtest says the calibration drifted.
 *
 * Shapes are negative-binomial shapes per game (Var = μ + μ²/k): the larger,
 * the closer to Poisson. Pure data.
 */
export interface MatchupParams {
  /** Shared per-game multiplier of goals, assists and power-play points (their covariance). */
  kOffense: number;
  /** Per-game shape of shots, hits and blocks. */
  kShots: number;
  kHits: number;
  kBlocks: number;
  /** Shots against per start: shape. */
  kShotsAgainst: number;
  /** Per-start multiplier of the goals-against rate (save% noise): shape. */
  kSavePct: number;
  /** P(win | goals against) = sigmoid(a + b·GA): the slope; a is solved per goalie for his win rate. */
  winSlope: number;
  /** A starter's start share on the second night of a back-to-back, relative to his share. */
  backToBackStart: number;
  /** P(a healthy rostered skater dresses for one of his club's games). */
  skaterPlays: number;
  /**
   * What the projection does not know: each week, a skater's true goals,
   * assists and power-play rates are his projected ones times one
   * Gamma(k, 1/k) draw (shared by the three); his shots, hits and blocks
   * times another; a goalie's goals-against rate times a third. Fitted on
   * the FIT seasons' weeks by `scripts/backtest-matchup.ts --calibrate`
   * (category Brier, each group on its own categories). Infinity: rates known.
   */
  kRateOffense: number;
  kRatePeripheral: number;
  kRateGoalie: number;
}

export const MATCHUP_PARAMS: MatchupParams = {
  // Goals and assists of one skater are not over-dispersed together per
  // game (their pooled covariance is ≤ 0): no shared multiplier.
  kOffense: Infinity,
  kShots: 23.62,
  kHits: 9.09,
  kBlocks: 12.99,
  kShotsAgainst: 66.15,
  // Goals against given shots are binomial (under-dispersed next to a
  // Poisson): no extra save% noise per start.
  kSavePct: Infinity,
  winSlope: -1.066,
  backToBackStart: 0.574,
  skaterPlays: 0.928,
  // --calibrate on 1,320 matchups of 2022-23 and 2023-24 (1,000 draws each;
  // a player's club known the Monday before only: his last game, never the
  // week predicted), category Brier by shape (∞ / 120 / 60 / 40 / 15 / 12 /
  // 10 / 8 / 6 / 5): G A PPP flat at 0.2104-0.2108 (no evidence: none); SOG
  // HIT BLK 0.1961 at ∞ down to 0.1943 at 6-12 (15: 0.1945, within the
  // noise); W GAA SV% SHO 0.1404-0.1412, best at ∞ (none). The shots-hits-
  // blocks rates of a skater's week vary by ~26 % around the projection
  // (role, linemates, injuries the Monday-before projection cannot see).
  kRateOffense: Infinity,
  kRatePeripheral: 15,
  kRateGoalie: Infinity,
};
