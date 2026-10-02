/**
 * Who belongs on the pre-season board, and the games a club's skaters can
 * share (scripts/generate-projections.ts, tested by test-projection-pool).
 *
 * - Stale players: a player on no NHL club list today (roster, prospect
 *   list or the search index's organisation, src/data/nhl-rosters.json)
 *   who has not played an NHL game in two seasons is not projected: the
 *   2026-07-30 board gave Okposo, Fast,
 *   Clutterbuck and Cogliano 64-72 games without an NHL game since 2023-24,
 *   and kept unsigned veterans in every free-agent list.
 * - Rookie games: a skater without a recent NHL game has no model GP; he
 *   gets the first-NHL-season games of his draft slot (2015-16 → 2025-26,
 *   players who played), in full on a club's roster, half on its prospect
 *   or organisation list (capped at 30), a third off every list.
 * - Club budget: a club dresses 18 skaters a game, 18 × 82 skater-games on
 *   the 82-game basis of the projections; a club whose skaters' projected
 *   games fall outside ±5 % of it is brought back to the band, the games
 *   moved in proportion to gp × (82 − gp) (the players whose availability is
 *   uncertain absorb them, not the iron men or the unused depth).
 */
import type { NhlListKind } from "./nhl-rosters";

const FULL_SEASON = 82;

/** First NHL season games (82-game basis) by overall pick, players who played. */
export const ROOKIE_GP_BY_PICK: ReadonlyArray<{ maxPick: number; gp: number }> = [
  { maxPick: 5, gp: 48.6 },
  { maxPick: 15, gp: 30.2 },
  { maxPick: 32, gp: 19.3 },
  { maxPick: Number.POSITIVE_INFINITY, gp: 18.8 },
];
export const ROOKIE_GP_UNDRAFTED = 16.5;
/** Share of the slot's games by where the club lists him. */
export const ROOKIE_LIST_FACTOR: Readonly<Record<NhlListKind | "none", number>> = {
  roster: 1,
  prospect: 0.5,
  org: 0.5,
  none: 1 / 3,
};
export const ROOKIE_OFF_ROSTER_MAX_GP = 30;

export function rookieGpPrior(overallPick: number | null | undefined, list: NhlListKind | null | undefined): number {
  const pick = overallPick != null && overallPick > 0 ? overallPick : null;
  const slot = pick == null ? ROOKIE_GP_UNDRAFTED : ROOKIE_GP_BY_PICK.find((b) => pick <= b.maxPick)!.gp;
  const gp = slot * ROOKIE_LIST_FACTOR[list ?? "none"];
  return Math.max(1, Math.round(list === "roster" ? gp : Math.min(ROOKIE_OFF_ROSTER_MAX_GP, gp)));
}

/** Why a player should not be on the board, or null. */
export function staleReason(
  id: number,
  lists: ReadonlyMap<number, NhlListKind> | null,
  profile: { isActive?: boolean; teamHistory: Array<{ seasonId: number; gamesPlayed: number }> } | undefined,
  lastTwoSeasons: readonly [number, number],
): string | null {
  if (!lists || lists.has(id)) return null;
  const recent = profile?.teamHistory.some((h) => lastTwoSeasons.includes(h.seasonId) && h.gamesPlayed > 0) ?? false;
  // A recent NHL regular stays even off the lists (and even if the NHL's
  // July `isActive` said otherwise): the search index lags signings (Carson
  // Soucy, on no list on 2026-09-28, played on opening night).
  return recent ? null : "aucune liste LNH, aucun match en deux saisons";
}

export const SKATER_GAMES_PER_TEAM = 18 * FULL_SEASON;
export const TEAM_GP_BAND = 0.05;

/**
 * Per-player GP after bringing each club's skater total into
 * [1 − band, 1 + band] × SKATER_GAMES_PER_TEAM. Players keep 0 ≤ gp ≤ ceiling.
 */
export function normalizeTeamSkaterGp(
  players: ReadonlyArray<{ id: number; team: string; gamesPlayed: number }>,
  ceiling: number,
  target = SKATER_GAMES_PER_TEAM,
  band = TEAM_GP_BAND,
): Map<number, number> {
  const out = new Map<number, number>();
  const byTeam = new Map<string, Array<{ id: number; gp: number }>>();
  for (const p of players) {
    const list = byTeam.get(p.team) ?? [];
    list.push({ id: p.id, gp: p.gamesPlayed });
    byTeam.set(p.team, list);
  }
  for (const list of byTeam.values()) {
    const total = list.reduce((s, p) => s + p.gp, 0);
    const lo = target * (1 - band);
    const hi = target * (1 + band);
    let delta = total < lo ? lo - total : total > hi ? hi - total : 0;
    if (delta === 0) continue;
    // A few passes: a player who hits a bound hands the rest to the others.
    const gp = new Map(list.map((p) => [p.id, p.gp]));
    for (let pass = 0; pass < 5 && Math.abs(delta) > 0.5; pass++) {
      const w = list.map((p) => {
        const g = gp.get(p.id)!;
        const room = delta > 0 ? ceiling - g : g;
        return room > 0 ? (g * (FULL_SEASON - g)) / FULL_SEASON + 1e-6 : 0;
      });
      const sw = w.reduce((s, x) => s + x, 0);
      if (!(sw > 0)) break;
      let moved = 0;
      list.forEach((p, i) => {
        const g = gp.get(p.id)!;
        const want = (delta * w[i]!) / sw;
        const next = Math.max(0, Math.min(ceiling, g + want));
        moved += next - g;
        gp.set(p.id, next);
      });
      delta -= moved;
    }
    for (const p of list) out.set(p.id, gp.get(p.id)!);
  }
  return out;
}
