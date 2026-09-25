/**
 * When a categories league's draft is over (pure, tiny: the « Mes ligues »
 * card reads it without the player table's code).
 */

/** After this long past the scheduled start, the draft is over whatever was marked. */
export const DRAFT_DONE_AFTER_MS = 12 * 60 * 60 * 1000;

/**
 * The draft is over: every pick is marked (rounds × teams), or the start
 * was more than 12 h ago. `nowMs` only exists in effects (null before:
 * never over by the clock, so the prerendered page and the first render
 * agree).
 */
export function draftDone(
  league: { teams: number; rounds: number; draftStartsAt: string },
  state: { picks: readonly unknown[] },
  nowMs: number | null,
): boolean {
  if (state.picks.length >= league.teams * league.rounds) return true;
  if (nowMs === null) return false;
  const start = Date.parse(league.draftStartsAt);
  return Number.isFinite(start) && nowMs > start + DRAFT_DONE_AFTER_MS;
}
