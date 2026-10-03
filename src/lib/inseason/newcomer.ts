/**
 * Prior of a newcomer (NHL games this season, no pre-season projection: a
 * call-up, a rookie the pre-season pool missed) from the role his club gives
 * him: per-game rates and games share as a line in his ice time and
 * power-play time so far (recency-weighted, src/lib/inseason/skater.ts), fit
 * on every first NHL season of 2021-22 → 2025-26 (a skater without an NHL
 * game in the three seasons before), the rest of his season after each
 * checkpoint. A call-up on the first line and the first power-play unit is
 * not a fourth-liner up for a week.
 *
 * Refit and scored leave-one-season-out by scripts/backtest-in-season-newcomers.ts.
 */
import { USAGE_STATS, type UsageStat } from "./skater";

/** Rate per game = a + b × ice time (min) + c × PP time (min), floored at 0. */
export const NEWCOMER_RATE_LINES: Readonly<Record<"F" | "D", Readonly<Record<UsageStat, readonly [number, number, number]>>>> = {
  F: {
    goals: [-0.00976, 0.01135, 0.02588],
    assists: [-0.13371, 0.02541, 0.02119],
    powerplayPoints: [-0.08722, 0.0096, 0.0265],
    shots: [-0.00421, 0.10774, 0.09282],
    hits: [1.7567, -0.02872, -0.23811],
    blocks: [0.30276, 0.01392, -0.0393],
    penaltyMinutes: [0.79879, -0.02921, -0.01065],
    faceoffWins: [-0.39741, 0.14045, -0.03154],
  },
  D: {
    goals: [-0.01212, 0.00385, 0.01284],
    assists: [-0.03702, 0.01243, 0.03718],
    powerplayPoints: [-0.06348, 0.00513, 0.03634],
    shots: [0.02786, 0.06042, 0.14666],
    hits: [0.61364, 0.05111, -0.28704],
    blocks: [0.04893, 0.07091, -0.05389],
    penaltyMinutes: [0.59923, -0.00461, -0.00006],
    faceoffWins: [0, 0, 0],
  },
};
/** Share of his team's games from now on = a + b × ice time (min), within [0.05, 0.95]. */
export const NEWCOMER_SHARE_LINES: Readonly<Record<"F" | "D", readonly [number, number]>> = { F: [-0.29522, 0.05947], D: [-0.41993, 0.05235] };
/** Games before his own rates weigh as much as the role-based prior. */
export const NEWCOMER_USAGE_K = 10;

export function newcomerRates(pos: "F" | "D", toi: number, pp: number, lines = NEWCOMER_RATE_LINES): Record<UsageStat, number> {
  const out = {} as Record<UsageStat, number>;
  for (const st of USAGE_STATS) {
    const [a, b, c] = lines[pos][st];
    out[st] = Math.max(0, a + b * toi + c * pp);
  }
  return out;
}

export function newcomerShare(pos: "F" | "D", toi: number, lines = NEWCOMER_SHARE_LINES): number {
  const [a, b] = lines[pos];
  return Math.max(0.05, Math.min(0.95, a + b * toi));
}
