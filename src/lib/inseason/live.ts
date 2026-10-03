/**
 * Plumbing of the daily in-season update (scripts/update-in-season.ts) from
 * the stats REST rows to the inputs of src/lib/inseason/skater.ts: his
 * games this season (ice time, PP time), the team games he dressed for, his
 * ice time before the season. Pure, unit-tested (scripts/test-in-season.ts).
 */

/** One game of a skater this season (stats REST time-on-ice report, isGame). */
export interface GameUsage {
  gameId: number;
  /** Local game date (YYYY-MM-DD). */
  date: string;
  team: string;
  /** Minutes: all situations, power play. */
  toi: number;
  pp: number;
}

const byDate = (a: { date: string; gameId: number }, b: { date: string; gameId: number }) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.gameId - b.gameId;

/** Rows of the time-on-ice report (seconds) → each player's games, oldest first, and each team's games. */
export function gamesFromRows(rows: ReadonlyArray<Record<string, unknown>>): {
  byPlayer: Map<number, GameUsage[]>;
  teamGames: Map<string, number[]>;
} {
  const byPlayer = new Map<number, GameUsage[]>();
  const teams = new Map<string, Map<number, string>>();
  const seen = new Set<string>();
  for (const r of rows) {
    const id = Number(r.playerId);
    const gameId = Number(r.gameId);
    const team = String(r.teamAbbrev ?? "");
    const date = String(r.gameDate ?? "");
    if (!Number.isFinite(id) || !Number.isFinite(gameId) || !team || !date) continue;
    const k = `${id}:${gameId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const g: GameUsage = { gameId, date, team, toi: (Number(r.timeOnIce) || 0) / 60, pp: (Number(r.ppTimeOnIce) || 0) / 60 };
    if (!byPlayer.has(id)) byPlayer.set(id, []);
    byPlayer.get(id)!.push(g);
    if (!teams.has(team)) teams.set(team, new Map());
    teams.get(team)!.set(gameId, date);
  }
  for (const l of byPlayer.values()) l.sort(byDate);
  const teamGames = new Map<string, number[]>();
  for (const [t, m] of teams) teamGames.set(t, [...m].map(([gameId, date]) => ({ gameId, date })).sort(byDate).map((g) => g.gameId));
  return { byPlayer, teamGames };
}

/**
 * The games of his team so far (oldest first): true where he dressed. A
 * player who also played for another club this season: his games count as
 * the latest of his current club's (his share is over his own games).
 */
export function playedFlags(teamGameIds: readonly number[], mine: readonly GameUsage[], team: string): boolean[] {
  const ids = new Set(mine.filter((g) => g.team === team).map((g) => g.gameId));
  const flags = teamGameIds.map((g) => ids.has(g));
  if (mine.some((g) => g.team !== team)) {
    const n = Math.min(mine.length, flags.length);
    return flags.map((_, i) => i >= flags.length - n);
  }
  return flags;
}

/** Leave out the games of a CURRENT reported absence: up to `missed` trailing games he did not dress for. */
export function trimCurrentAbsence(flags: readonly boolean[], missed: number): boolean[] {
  const out = [...flags];
  let k = Math.max(0, Math.floor(missed));
  while (k > 0 && out.length > 0 && out[out.length - 1] === false) {
    out.pop();
    k--;
  }
  return out;
}

/** Ice time and PP time per game before the season: 2:1 (by games) over the two seasons before. */
export function priorUsageOf(seasons: ReadonlyArray<{ gp: number; toi: number; pp: number } | undefined>, weights: readonly number[] = [2, 1]): { toi: number | null; pp: number | null } {
  let w = 0, u = 0, p = 0;
  seasons.forEach((x, i) => {
    if (!x || !(x.gp > 0) || !(x.toi > 0)) return;
    const k = weights[i] ?? 0;
    w += k * x.gp;
    u += k * x.toi;
    p += k * x.pp;
  });
  return w > 0 ? { toi: u / w, pp: p / w } : { toi: null, pp: null };
}
