/**
 * When an absent player comes back. A player ruled out today (injured, on
 * the NHL IR, suspended) is not out for the rest of the season: of the NHL
 * regulars who had missed 3 straight club games in 2021-22..2025-26 (4,470
 * absences, scripts/backtest-absence.ts), 21 % dressed for the next one,
 * 54 % within 5, 69 % within 10, 78 % within 20; 17 % never came back that
 * season. A later lineup day is worth his usual value times the odds he is
 * back by then, so his rest-of-season value (a drop's cost, an injured free
 * agent's worth) is not zero.
 *
 * NOT SHIPPED: in backtest-mgmt-waivers.ts (`--return=on`) it lost 21.0
 * [12.9, 29.1] points a team-season against valuing absent players at 0 —
 * though that sim lets a dropped player be re-added at will (nobody else
 * claims), which flatters dropping the injured. Kept here, off by default.
 */

/** Club games ahead (1 = his club's next game) → share back by then. */
const BACK_WITHIN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0.205],
  [2, 0.345],
  [3, 0.43],
  [5, 0.54],
  [7, 0.612],
  [10, 0.689],
  [15, 0.75],
  [20, 0.784],
  [30, 0.811],
  [40, 0.821],
];

/** NHL clubs play about one game every 2.15 days over a regular season. */
export const DAYS_PER_CLUB_GAME = 2.15;

/** Odds an absent player is back for his club's `games`-th game from now (0 = today: still out). */
export function returnOdds(games: number): number {
  if (!(games > 0)) return 0;
  for (let i = 1; i < BACK_WITHIN.length; i++) {
    const [k1, p1] = BACK_WITHIN[i]!;
    if (games <= k1) {
      const [k0, p0] = BACK_WITHIN[i - 1]!;
      return p0 + ((p1 - p0) * (games - k0)) / (k1 - k0);
    }
  }
  return BACK_WITHIN[BACK_WITHIN.length - 1]![1];
}
