import { fillSlots, type SlotSpec } from "../leagues/slot-fill";
import { STARTING_SLOTS, type LeagueCategory, type StartingSlot } from "../leagues/types";
import type { Position } from "../types";
import { isGoalieBoardPlayer, type DraftBoard, type DraftBoardPlayer } from "./board-types";

export interface MyLineup {
  starters: Record<StartingSlot, DraftBoardPlayer[]>;
  bench: DraftBoardPlayer[];
  /** Past the bench: would need an IR+/NA spot or a drop. */
  overflow: DraftBoardPlayer[];
}

interface FillItem {
  id: number;
  positions: readonly Position[];
  value: number;
  player: DraftBoardPlayer | null;
}

/** Eligibility token only a slot's own waiver placeholders carry. */
const waiverToken = (slot: StartingSlot) => `waiver:${slot}` as unknown as Position;

/**
 * Our roster seated for maximum lineup VOR, with the same exact matroid fill
 * as the league model (`fillSlots`): a C/LW drafted early slides to LW the
 * moment a pure C arrives, and D compete with forwards only for Util.
 *
 * Every seat also has a waiver placeholder worth that seat's replacement
 * value (slot VOR 0 — "an empty seat is a waiver pickup"). A player is only
 * seated where he beats it, so a fifth D below the Util replacement goes to
 * the bench instead of being charged a negative Util VOR, and when two D
 * compete for D + Util the better one keeps the D seat. With all seats filled
 * Σ(value − replacement) and Σ value differ by a constant, so maximising
 * value with placeholders maximises lineup VOR.
 */
export function buildLineup(board: DraftBoard, players: readonly DraftBoardPlayer[]): MyLineup {
  const activeSlots = STARTING_SLOTS.filter((s) => (board.league.roster[s] ?? 0) > 0);
  const items: FillItem[] = players.map((p) => ({ id: p.id, positions: p.pos, value: p.value, player: p }));
  let placeholderId = -1;
  for (const slot of activeSlots) {
    const value = board.replacement[slot] ?? 0;
    for (let i = 0; i < board.league.roster[slot]; i++) {
      items.push({ id: placeholderId--, positions: [waiverToken(slot)], value, player: null });
    }
  }
  // Ties: a real player before a placeholder (slot VOR exactly 0 still counts
  // as "he plays"), then by id for determinism.
  items.sort(
    (a, b) =>
      b.value - a.value ||
      Number(a.player == null) - Number(b.player == null) ||
      a.id - b.id,
  );
  const slots: SlotSpec<StartingSlot>[] = activeSlots.map((s) => ({
    slot: s,
    capacity: board.league.roster[s],
    accepts: [...board.league.slotEligibility[s], waiverToken(s)],
  }));
  const fill = fillSlots(items, slots);
  const starters = Object.fromEntries(
    STARTING_SLOTS.map((s) => [
      s,
      (fill.bySlot.get(s) ?? [])
        .map((x) => x.player)
        .filter((p): p is DraftBoardPlayer => p != null)
        .sort((a, b) => b.value - a.value || a.id - b.id),
    ]),
  ) as Record<StartingSlot, DraftBoardPlayer[]>;
  const benchSize = board.league.roster.BN ?? 0;
  const rest = fill.unassigned
    .map((x) => x.player)
    .filter((p): p is DraftBoardPlayer => p != null);
  return { starters, bench: rest.slice(0, benchSize), overflow: rest.slice(benchSize) };
}

export function startingSeatCount(board: DraftBoard): number {
  return STARTING_SLOTS.reduce((s, slot) => s + (board.league.roster[slot] ?? 0), 0);
}

export function filledStarterCount(lineup: MyLineup): number {
  return STARTING_SLOTS.reduce((s, slot) => s + lineup.starters[slot].length, 0);
}

/**
 * Bench worth, as a share of VOR. Lineups are daily, so a bench skater
 * plays whenever a starter's team is off (~a third of his games count); a
 * third goalie fills an empty G seat on roughly half his starts and is what
 * keeps a team over the 4-appearance minimum; a fourth rarely finds a seat.
 */
export const BENCH_SKATER_SHARE = 0.35;
export const BENCH_GOALIE_SHARES = [0.5, 0.15] as const;

export function slotVor(board: DraftBoard, player: DraftBoardPlayer, slot: StartingSlot): number {
  return player.value - (board.replacement[slot] ?? 0);
}

/**
 * Lineup worth in VOR units: every starter's value over the replacement for
 * the seat he holds (an empty seat = a waiver pickup = 0), plus bench shares.
 */
export function lineupScore(board: DraftBoard, lineup: MyLineup): number {
  let score = 0;
  for (const slot of STARTING_SLOTS) {
    for (const p of lineup.starters[slot]) score += slotVor(board, p, slot);
  }
  let benchGoalies = 0;
  for (const p of lineup.bench) {
    if (isGoalieBoardPlayer(p)) {
      const share = BENCH_GOALIE_SHARES[Math.min(benchGoalies, BENCH_GOALIE_SHARES.length - 1)];
      score += share * Math.max(0, p.vor);
      benchGoalies++;
    } else {
      score += BENCH_SKATER_SHARE * Math.max(0, p.vor);
    }
  }
  return score;
}

export interface CategoryStrength {
  cat: LeagueCategory;
  goalie: boolean;
  /** Our starters' summed z, empty seats filled with the league-average seat. */
  mine: number;
  /** League-average team's summed z. */
  average: number;
  /** mine − average (z units; positive = stronger, GAA included). */
  diff: number;
  /** Projected category totals (display units). */
  mineTotal: number;
  averageTotal: number;
}

/**
 * Category profile of our team against a league-average team. Empty seats
 * take the league-average player *for that seat*, so the bars show only
 * what our picks change — two picks in, a team isn't "weak everywhere".
 */
export function teamCategoryStrength(board: DraftBoard, lineup: MyLineup): CategoryStrength[] {
  const out: CategoryStrength[] = [];
  const roster = board.league.roster;
  const skaterSlots = STARTING_SLOTS.filter((s) => s !== "G" && (roster[s] ?? 0) > 0);

  board.categories.skater.forEach((cat, i) => {
    let mine = 0;
    let average = 0;
    let mineTotal = 0;
    let averageTotal = 0;
    for (const slot of skaterSlots) {
      const seats = roster[slot];
      const avg = board.averageTeam.slots[slot];
      const seated = lineup.starters[slot];
      const empty = Math.max(0, seats - seated.length);
      for (const p of seated) {
        mine += p.z[i] ?? 0;
        mineTotal += p.proj[i] ?? 0;
      }
      mine += empty * (avg?.z[i] ?? 0);
      mineTotal += empty * (avg?.stats[i] ?? 0);
      average += seats * (avg?.z[i] ?? 0);
      averageTotal += seats * (avg?.stats[i] ?? 0);
    }
    out.push({ cat, goalie: false, mine, average, diff: mine - average, mineTotal, averageTotal });
  });

  const gSeats = roster.G ?? 0;
  const gAvg = board.averageTeam.slots.G;
  const seatedG = lineup.starters.G;
  const emptyG = Math.max(0, gSeats - seatedG.length);
  const fields = board.goalieVolumeFields;
  const avgVol = (f: string) => gAvg?.stats[(fields as readonly string[]).indexOf(f)] ?? 0;
  const catIndex = (c: LeagueCategory) => (board.categories.goalie as readonly string[]).indexOf(c);
  const vol = (list: DraftBoardPlayer[], extra: number) => {
    const sum = { wins: 0, shutouts: 0, sv: 0, ga: 0, gp: 0 };
    for (const p of list) {
      sum.wins += p.proj[catIndex("wins")] ?? 0;
      sum.shutouts += p.proj[catIndex("shutouts")] ?? 0;
      sum.sv += p.sv ?? 0;
      sum.ga += p.ga ?? 0;
      sum.gp += p.gp;
    }
    sum.wins += extra * avgVol("wins");
    sum.shutouts += extra * avgVol("shutouts");
    sum.sv += extra * avgVol("sv");
    sum.ga += extra * avgVol("ga");
    sum.gp += extra * avgVol("gp");
    return sum;
  };
  const displayTotal = (cat: LeagueCategory, v: ReturnType<typeof vol>): number => {
    if (cat === "wins") return v.wins;
    if (cat === "shutouts") return v.shutouts;
    if (cat === "savePct") return v.sv + v.ga > 0 ? v.sv / (v.sv + v.ga) : 0;
    return v.gp > 0 ? v.ga / v.gp : 0;
  };
  const mineVol = vol(seatedG, emptyG);
  const avgTeamVol = vol([], gSeats);
  board.categories.goalie.forEach((cat, i) => {
    let mine = 0;
    for (const p of seatedG) mine += p.z[i] ?? 0;
    mine += emptyG * (gAvg?.z[i] ?? 0);
    const average = gSeats * (gAvg?.z[i] ?? 0);
    out.push({
      cat,
      goalie: true,
      mine,
      average,
      diff: mine - average,
      mineTotal: displayTotal(cat, mineVol),
      averageTotal: displayTotal(cat, avgTeamVol),
    });
  });
  return out;
}

/** Categories we trail the average team in the most (up to 3, diff < −0.25 z). */
export function categoryTargets(strength: readonly CategoryStrength[]): LeagueCategory[] {
  return strength
    .filter((s) => s.diff < -0.25)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 3)
    .map((s) => s.cat);
}
