/**
 * Snake-draft arithmetic. Picks, rounds and slots are 1-based; odd rounds run
 * slot 1 → N, even rounds N → 1.
 */

export function snakePickNumber(round: number, slot: number, teams: number): number {
  const inRound = round % 2 === 1 ? slot : teams + 1 - slot;
  return (round - 1) * teams + inRound;
}

/** Every overall pick number a draft slot owns. */
export function myPickNumbers(slot: number, teams: number, rounds: number): number[] {
  if (!Number.isInteger(slot) || slot < 1 || slot > teams) return [];
  return Array.from({ length: rounds }, (_, i) => snakePickNumber(i + 1, slot, teams));
}

/** Round, pick within round, and which draft slot is on the clock. */
export function pickInfo(
  pick: number,
  teams: number,
): { round: number; pickInRound: number; slot: number } {
  const round = Math.floor((pick - 1) / teams) + 1;
  const pickInRound = ((pick - 1) % teams) + 1;
  const slot = round % 2 === 1 ? pickInRound : teams + 1 - pickInRound;
  return { round, pickInRound, slot };
}

/** First of `myPicks` at or after `pick` (null when none left). */
export function nextMyPick(myPicks: readonly number[], pick: number): number | null {
  for (const p of myPicks) if (p >= pick) return p;
  return null;
}

/** First of `myPicks` strictly after `pick`. */
export function myPickAfter(myPicks: readonly number[], pick: number): number | null {
  for (const p of myPicks) if (p > pick) return p;
  return null;
}
