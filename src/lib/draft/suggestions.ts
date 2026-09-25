import type { Position } from "../types";
import type { StartingSlot } from "../leagues/types";
import { STARTING_SLOTS } from "../leagues/types";
import { probAvailableAt } from "./availability";
import type { DraftBoard, DraftBoardPlayer } from "./board-types";
import {
  currentPickNumber,
  myPickIds,
  pickedIds,
  type DraftState,
} from "./draft-state";
import { myPickAfter, myPickNumbers, nextMyPick } from "./snake";
import {
  buildLineup,
  lineupScore,
  teamCategoryStrength,
  type CategoryStrength,
  type MyLineup,
} from "./team";

/**
 * Pick suggestions = what a player adds to *our* lineup, not raw VOR:
 *
 *   score = gain + scarcity + balance
 *
 * - gain: lineup VOR with him − without him (see `lineupScore`). A fourth
 *   centre when C, F and Util are full only earns his bench share.
 * - scarcity (VONA): his VOR minus the *expected best* VOR still there at
 *   our following pick among players who could replace him (same eligible
 *   position), each weighted by the chance he survives until then. Half
 *   weight: it is a forecast from a proxy market.
 * - balance: a small nudge toward players who *lift* the categories where
 *   we trail the league-average team (categories win weeks, not totals).
 *   Measured as the change he makes to our category profile — his line
 *   against the average player of the seat he takes (or against the starter
 *   he pushes to the bench) — never his raw z: raw skater z carries the F/D
 *   group offset, so every D would look like a blocks fix, blocks-poor ones
 *   included. A benched pick changes nothing and gets no balance.
 */
export const SCARCITY_WEIGHT = 0.5;
export const BALANCE_WEIGHT = 0.15;
/** When not on the clock, hide players unlikely to reach our pick. */
export const MIN_AVAILABILITY_OFF_CLOCK = 0.2;
const CANDIDATE_POOL = 90;
const REPLACEMENT_POOL = 40;
const POSITIONS: readonly Position[] = ["C", "LW", "RW", "D", "G"];

export interface Suggestion {
  player: DraftBoardPlayer;
  score: number;
  gain: number;
  scarcity: number;
  balance: number;
  /** P(still available at our target pick). */
  availability: number;
  seatedAs: StartingSlot | "BN" | null;
}

export interface DraftTimeline {
  currentPick: number;
  totalPicks: number;
  myPicks: number[];
  /** Our pick being prepared: the current one when on the clock. */
  targetPick: number | null;
  /** Our pick after the target (null in the last round or with no slot). */
  followingPick: number | null;
  onTheClock: boolean;
  draftOver: boolean;
}

export function draftTimeline(board: DraftBoard, state: DraftState): DraftTimeline {
  const totalPicks = board.league.teams * board.league.rounds;
  const currentPick = currentPickNumber(state);
  const myPicks = state.slot
    ? myPickNumbers(state.slot, board.league.teams, board.league.rounds)
    : [];
  const targetPick = state.slot ? nextMyPick(myPicks, currentPick) : null;
  const followingPick = targetPick != null ? myPickAfter(myPicks, targetPick) : null;
  return {
    currentPick,
    totalPicks,
    myPicks,
    targetPick,
    followingPick,
    onTheClock: targetPick != null && targetPick === currentPick,
    draftOver: currentPick > totalPicks,
  };
}

function seatOf(lineup: MyLineup, id: number): StartingSlot | "BN" | null {
  for (const slot of STARTING_SLOTS) {
    if (lineup.starters[slot].some((p) => p.id === id)) return slot;
  }
  return lineup.bench.some((p) => p.id === id) ? "BN" : null;
}

/**
 * E[max VOR available at `pick`] among `list` (VOR-descending), each player
 * surviving independently with his own availability: Σ vorᵢ·Pᵢ·Πⱼ<ᵢ(1−Pⱼ).
 * Nobody left → a waiver player, VOR 0.
 */
function expectedBestVor(
  list: readonly DraftBoardPlayer[],
  currentPick: number,
  pick: number,
  skipId: number,
): number {
  let expected = 0;
  let noneYet = 1;
  for (const p of list) {
    if (p.id === skipId) continue;
    const alive = probAvailableAt(p, currentPick, pick);
    expected += Math.max(0, p.vor) * alive * noneYet;
    noneYet *= 1 - alive;
    if (noneYet < 1e-4) break;
  }
  return expected;
}

export interface SuggestionResult {
  timeline: DraftTimeline;
  suggestions: Suggestion[];
  lineup: MyLineup;
  strength: CategoryStrength[];
}

export function suggestPicks(
  board: DraftBoard,
  state: DraftState,
  limit = 5,
): SuggestionResult {
  const timeline = draftTimeline(board, state);
  const taken = pickedIds(state);
  const byId = new Map(board.players.map((p) => [p.id, p]));
  const mine = myPickIds(state)
    .map((id) => byId.get(id))
    .filter((p): p is DraftBoardPlayer => p != null);
  const lineup = buildLineup(board, mine);
  const strength = teamCategoryStrength(board, lineup);
  if (timeline.draftOver) return { timeline, suggestions: [], lineup, strength };

  const available = board.players.filter((p) => !taken.has(p.id));
  const base = lineupScore(board, lineup);
  const current = timeline.currentPick;
  const target = timeline.targetPick ?? current;
  const following = timeline.followingPick;

  // Weakness weight per category: 0 at/above average, → 1 at 3 z behind.
  const weakness = new Map(
    strength.map((s) => [s.cat, Math.max(0, Math.min(1, -s.diff / 3))]),
  );

  const byPosition = new Map<Position, DraftBoardPlayer[]>(
    POSITIONS.map((pos) => [
      pos,
      available.filter((p) => p.pos.includes(pos)).slice(0, REPLACEMENT_POOL),
    ]),
  );

  const candidates = available.slice(0, CANDIDATE_POOL);
  // Late in a draft the top-VOR pool can be all one position; always look at
  // the best few available at every position too.
  for (const pos of POSITIONS) {
    for (const p of byPosition.get(pos)!.slice(0, 5)) {
      if (!candidates.includes(p)) candidates.push(p);
    }
  }

  const out: Suggestion[] = [];
  for (const p of candidates) {
    const availability = probAvailableAt(p, current, target);
    if (!timeline.onTheClock && availability < MIN_AVAILABILITY_OFF_CLOCK) continue;
    const withHim = buildLineup(board, [...mine, p]);
    const gain = lineupScore(board, withHim) - base;
    const fit = p.vor > 0 ? Math.max(0, Math.min(1, gain / p.vor)) : 0;

    let scarcity = 0;
    if (following != null && fit > 0) {
      const nextBest = Math.max(
        ...p.pos.map((pos) =>
          expectedBestVor(byPosition.get(pos) ?? [], current, following, p.id),
        ),
      );
      scarcity = SCARCITY_WEIGHT * fit * Math.max(0, p.vor - nextBest);
    }

    const after = teamCategoryStrength(board, withHim);
    let lean = 0;
    after.forEach((s, i) => {
      const w = weakness.get(s.cat) ?? 0;
      if (w <= 0) return;
      const lift = s.diff - (strength[i]?.diff ?? 0);
      lean += w * Math.max(0, lift) * (s.goalie ? board.goalieWeight.weight : 1);
    });
    const balance = BALANCE_WEIGHT * lean;

    out.push({
      player: p,
      score: gain + scarcity + balance,
      gain,
      scarcity,
      balance,
      availability,
      seatedAs: seatOf(withHim, p.id),
    });
  }

  out.sort((a, b) => b.score - a.score || a.player.rank - b.player.rank);
  return { timeline, suggestions: out.slice(0, limit), lineup, strength };
}
