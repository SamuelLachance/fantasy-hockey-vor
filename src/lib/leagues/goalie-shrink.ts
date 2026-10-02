import { impliedShotsAgainst } from "../goalie-impact";
import type { GoalieProjection, PlayerProjection } from "../types";

/**
 * Goalie SV% projections are over-dispersed, so the category engine shrinks
 * them before it values anybody.
 *
 * A projection of next season's SV% is an estimate of a goalie's *skill*, so
 * its spread should not exceed the spread of the best estimate of that skill.
 * `players.json` spreads SV% over ~0.0096 among workhorse goalies, and the
 * dataset agrees the goalie models are not informative
 * (`categoryWeights.goalie`: savePct R² −0.70, saves −0.98, wins −0.19,
 * shutouts −0.11: all worse than predicting the pool mean).
 *
 * How far to shrink. The repo's own history (`src/data/moneypuck-goalies.json`,
 * 608 consecutive-season pairs with ≥ 25 GP and ≥ 400 shots against in both
 * years) gives, read through Spearman-Brown for three seasons of history:
 * - year-over-year r on RAW SV% = 0.311 → ceiling 0.0051. This is NOT skill
 *   persistence: league SV% drifts (0.9149 in 2015-16, 0.8955 in 2025-26),
 *   and a drifting league mean correlates every goalie with himself;
 * - r on SV% centred on each season's mean = 0.141 → ceiling 0.0023, the
 *   actual skill figure (`scripts/test-goalie-shrink.ts` recomputes both).
 * The constant stays at 0.0051 as a backtested setting, not as that
 * derivation: shrinking to 0.0023 orders goalies worse on real seasons
 * (`scripts/backtest-category-vor.ts`: goalie Spearman 0.257 vs 0.271, and
 * a weaker simulated draft in every field).
 *
 * The shrink holds each goalie's projected shots against and games fixed and
 * pulls SV% toward the reference pool's shots-weighted mean, then rebuilds
 * `saves` from it, so goals against and GAA follow consistently. Wins and
 * shutouts are left alone (shutouts already get their own smoothing in
 * `category-vor.ts`). It is mean-preserving on the reference pool, so the
 * league-average SV% baseline does not move.
 *
 * It only composes SV% and GAA. It used to set the goalie weight as well (the
 * leverage was read off the shrunk spread: 0.51 / 0.59 / 0.81 for 0.0023 /
 * 0.0051 / no shrink); the exchange rate now reads the unshrunk spread and is
 * calibrated on its own (`GOALIE_WEIGHT_CALIBRATION` in `category-vor.ts`).
 *
 * This lives in the category-league path only: `players.json` is shared with
 * the points league and is not rewritten.
 */

/**
 * SV% spread the shrink brings the projections down to: a backtested setting
 * (see above). It equals the three-season ceiling of the RAW year-over-year
 * correlation; the season-centred skill ceiling is tighter (0.0023).
 */
export const GOALIE_SAVE_PCT_SKILL_SD = 0.0051;

/**
 * Projected GP a goalie needs to join the reference pool that sets the spread
 * and the centre — the same workload filter as the persistence sample.
 */
export const GOALIE_SHRINK_MIN_GP = 25;

export type ShrinkablePlayer = Pick<
  PlayerProjection,
  "isGoalie" | "gamesPlayed" | "projection"
>;

export interface GoalieSavePctShrink {
  /** Divisor applied to each goalie's deviation from `mean` (≥ 1). */
  factor: number;
  /** Shots-weighted SV% of the reference pool (the shrink target). */
  mean: number;
  /** SD of projected SV% over the reference pool, before the shrink. */
  spread: number;
  /** Reference-pool size. */
  count: number;
}

function savePctOf(p: ShrinkablePlayer): number {
  return (p.projection as GoalieProjection).savePct;
}

/** How much the pool's SV% spread has to shrink to reach the skill ceiling. */
export function goalieSavePctShrink(
  pool: readonly ShrinkablePlayer[],
  skillSd = GOALIE_SAVE_PCT_SKILL_SD,
): GoalieSavePctShrink {
  const reference = pool.filter(
    (p) => p.isGoalie && p.gamesPlayed >= GOALIE_SHRINK_MIN_GP && savePctOf(p) > 0,
  );
  let shots = 0;
  let saves = 0;
  for (const p of reference) {
    const proj = p.projection as GoalieProjection;
    shots += impliedShotsAgainst(proj);
    saves += proj.saves;
  }
  const mean = shots > 0 ? saves / shots : 0;
  const values = reference.map(savePctOf);
  let spread = 0;
  if (values.length > 1) {
    const m = values.reduce((a, b) => a + b, 0) / values.length;
    spread = Math.sqrt(
      values.reduce((s, x) => s + (x - m) ** 2, 0) / (values.length - 1),
    );
  }
  const factor = spread > skillSd && skillSd > 0 ? spread / skillSd : 1;
  return { factor, mean, spread, count: values.length };
}

/**
 * The pool with every goalie's SV% (and the `saves` that carries it) shrunk
 * toward the reference mean. Shots against and GP are untouched, so GA and
 * GAA move with SV% and nothing else changes.
 */
export function shrinkGoalieSavePct<T extends ShrinkablePlayer>(
  pool: readonly T[],
  skillSd = GOALIE_SAVE_PCT_SKILL_SD,
): { players: T[]; shrink: GoalieSavePctShrink } {
  const shrink = goalieSavePctShrink(pool, skillSd);
  if (!(shrink.factor > 1) || !(shrink.mean > 0)) {
    return { players: [...pool], shrink };
  }
  const players = pool.map((p) => {
    if (!p.isGoalie) return p;
    const proj = p.projection as GoalieProjection;
    const shots = impliedShotsAgainst(proj);
    if (!(shots > 0) || !(proj.savePct > 0)) return p;
    const savePct = shrink.mean + (proj.savePct - shrink.mean) / shrink.factor;
    return { ...p, projection: { ...proj, savePct, saves: shots * savePct } };
  });
  return { players, shrink };
}
