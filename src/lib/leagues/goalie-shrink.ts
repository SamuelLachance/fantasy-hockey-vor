import { impliedShotsAgainst } from "../goalie-impact";
import type { GoalieProjection, PlayerProjection } from "../types";

/**
 * Goalie SV% projections are over-dispersed, so the category engine shrinks
 * them before it values anybody.
 *
 * A projection of next season's SV% is an estimate of a goalie's *skill*, so
 * its spread can never exceed the spread of the best estimate of that skill —
 * the rest is noise presented as signal. Both are measurable from the repo's
 * own history (`src/data/moneypuck-goalies.json`, 608 consecutive-season
 * pairs with ≥ 25 GP and ≥ 400 shots against in both years, 2007-08 →
 * 2024-25): year-over-year SV% r = 0.311 with SD 0.01215. Reading r as a
 * one-season reliability,
 * - unlimited history: SD(skill) = √r × SD = 0.0068 — the hard ceiling,
 * - three seasons (what `player-profiles.json` holds): reliability
 *   3r/(1+2r) = 0.575 on a mean whose SD is 0.01215·√((1+2r)/3) = 0.00893,
 *   so the best predictor spreads 0.575 × 0.00893 ≈ 0.0051,
 * - one season: r × SD ≈ 0.0038.
 * 0.0051 is the relevant figure, and it is generous: goalies with two
 * seasons of history justify 0.0047.
 *
 * `players.json` spreads SV% over 0.0096 among workhorse goalies — about 1.9×
 * that — and the dataset agrees that the models are not informative
 * (`categoryWeights.goalie`: savePct R² −0.70, saves −0.98, wins −0.19,
 * shutouts −0.11: all worse than predicting the pool mean). Left alone, the
 * fake spread is what the engine's leverage machinery converts into a goalie
 * weight, and the whole goalie tier lands ~7 picks too early (first goalie
 * overall 21 instead of 28; a full shrink to the one-season figure would say
 * 35).
 *
 * The shrink holds each goalie's projected shots against and games fixed and
 * pulls SV% toward the reference pool's shots-weighted mean, then rebuilds
 * `saves` from it, so goals against and GAA follow consistently. Wins and
 * shutouts are left alone (shutouts already get their own smoothing in
 * `category-vor.ts`). It is mean-preserving on the reference pool, so the
 * league-average SV% baseline does not move.
 *
 * This lives in the category-league path only: `players.json` is shared with
 * the points league and is not rewritten.
 */

/**
 * Widest SV% spread a projection built on three seasons of history can
 * justify (see the derivation above). `scripts/test-goalie-shrink.ts`
 * recomputes it from `moneypuck-goalies.json`.
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
