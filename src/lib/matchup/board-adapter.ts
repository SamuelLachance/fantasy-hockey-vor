/**
 * A categories league's board players as the simulator's inputs: per-game
 * rates from the season projection (skaters: G A PPP SOG HIT BLK ÷ games;
 * goalies: wins, goals against and shots against per start, his share of
 * his club's starts), the lineup priority = the board's value. Also the
 * rosters the draft helper knows: the user's picks and, for any draft slot,
 * that slot's picks (snake order). Pure.
 */
import { effectiveValue, isGoalieBoardPlayer, type DraftBoardPlayer } from "../draft/board-types";
import { UNLISTED_PLAYER_ID, type DraftState } from "../draft/draft-state";
import { pickInfo } from "../draft/snake";
import type { SimGoalie, SimSkater, SimTeam } from "./simulate";

/** Regular-season games per club (2026-27: 84). */
export const CLUB_GAMES = 84;

const SKATER_POS = new Set(["C", "LW", "RW", "D"]);

export function toSimSkater(p: DraftBoardPlayer): SimSkater | null {
  if (p.noProj || !p.proj || isGoalieBoardPlayer(p) || !(p.gp > 0)) return null;
  const gp = p.gp;
  const r = p.proj.map((x) => Math.max(0, x) / gp);
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos.filter((x) => SKATER_POS.has(x)),
    rate: [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0, r[4] ?? 0, r[5] ?? 0],
    prio: effectiveValue(p),
  };
}

export function toSimGoalie(p: DraftBoardPlayer): SimGoalie | null {
  if (p.noProj || !p.proj || !isGoalieBoardPlayer(p) || !(p.gp > 0)) return null;
  const gp = p.gp;
  const ga = Math.max(0, p.ga ?? (p.proj[1] ?? 2.9) * gp);
  const sv = Math.max(0, p.sv ?? ((p.proj[2] ?? 0.9) / Math.max(1e-6, 1 - (p.proj[2] ?? 0.9))) * ga);
  return {
    id: p.id,
    name: p.name,
    team: p.team,
    start: Math.min(0.92, gp / CLUB_GAMES),
    w: Math.max(0, p.proj[0] ?? 0) / gp,
    ga: ga / gp,
    sa: (sv + ga) / gp,
    prio: effectiveValue(p),
  };
}

export function toSimTeam(players: readonly DraftBoardPlayer[], out: ReadonlySet<number> = new Set()): SimTeam {
  const live = players.filter((p) => !out.has(p.id));
  return {
    skaters: live.map(toSimSkater).filter((x): x is SimSkater => x != null),
    goalies: live.map(toSimGoalie).filter((x): x is SimGoalie => x != null),
  };
}

/** Player ids drafted from one snake slot (1-based), in pick order. */
export function slotPickIds(state: DraftState, slot: number, teams: number): number[] {
  const out: number[] = [];
  state.picks.forEach((p, i) => {
    if (p.id === UNLISTED_PLAYER_ID) return;
    if (pickInfo(i + 1, teams).slot === slot) out.push(p.id);
  });
  return out;
}
