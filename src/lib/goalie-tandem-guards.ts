/** Pure guards shared by CI (`check-players-data`) and unit tests. */

export function top3GoalieGpSum(gamesPlayed: number[]): number {
  return [...gamesPlayed]
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((s, g) => s + g, 0);
}

export function findOverloadedGoalieTeams(
  byTeam: Map<string, number[]>,
  maxSum = 100,
): string[] {
  const out: string[] = [];
  for (const [team, gps] of byTeam) {
    const sum = top3GoalieGpSum(gps);
    if (sum > maxSum) out.push(`${team}=${sum}`);
  }
  return out;
}

export function findUnderloadedGoalieTeams(
  byTeam: Map<string, number[]>,
  minSum = 60,
  minRoster = 2,
): string[] {
  const out: string[] = [];
  for (const [team, gps] of byTeam) {
    if (gps.length < minRoster) continue;
    const sum = top3GoalieGpSum(gps);
    if (sum < minSum) out.push(`${team}=${sum}`);
  }
  return out;
}

export function topGoalieGpTooLow(
  topGoalieGp: number | undefined,
  minGp = 40,
): boolean {
  return topGoalieGp != null && topGoalieGp < minGp;
}
