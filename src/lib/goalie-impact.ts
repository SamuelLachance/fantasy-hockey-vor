import type { GoalieProjection } from "./types";

/** Shots against implied by a goalie projection (saves ÷ save%). */
export function impliedShotsAgainst(projection: GoalieProjection): number {
  return projection.savePct > 0 ? projection.saves / projection.savePct : 0;
}

/** Shots-weighted league-average save% over a pool of goalie projections. */
export function leagueAverageSavePct(pool: GoalieProjection[]): number {
  let saves = 0;
  let shots = 0;
  for (const p of pool) {
    saves += p.saves;
    shots += impliedShotsAgainst(p);
  }
  return shots > 0 ? saves / shots : 0;
}

/**
 * Saves above average: saves minus what a league-average goalie would stop on
 * the same shots. Team SV% in a categories league is total saves ÷ total
 * shots, so a goalie's SV% impact scales with shots faced — a backup's .909
 * over 28 games must not outrank a starter's .907 over 51.
 */
export function savesAboveAverage(
  projection: GoalieProjection,
  leagueSavePct: number,
): number {
  return projection.saves - leagueSavePct * impliedShotsAgainst(projection);
}
