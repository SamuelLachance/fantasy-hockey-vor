import type { Position } from "../types";

export interface SlotSpec<S extends string = string> {
  slot: S;
  /** Total seats of this slot type across the league (teams × per-team). */
  capacity: number;
  accepts: readonly Position[];
}

export interface FillablePlayer {
  id: number;
  positions: readonly Position[];
}

export interface FillResult<P extends FillablePlayer, S extends string> {
  /** Player id → slot type it ended up in. */
  slotOf: Map<number, S>;
  /** Assigned players per slot type, in the order they were seated. */
  bySlot: Map<S, P[]>;
  /** Players (in input order) that could not be seated. */
  unassigned: P[];
}

/**
 * Seat players, best first, into league-wide slot capacities with
 * multi-eligibility and flex slots (F, Util).
 *
 * "Which players can all be seated at once" is a transversal matroid, so
 * taking players in descending value and keeping each one whenever *some*
 * reshuffle of the already-seated players makes room is exactly optimal: the
 * kept set has the maximum total value any legal lineup assignment can reach.
 * A plain "first free eligible slot" greedy is not — a C/LW seated at C can
 * block a pure C later although moving him to LW would have fit both. The
 * reshuffle is an augmenting path over slot *types* (≤ 7 nodes), found by BFS,
 * so the whole fill stays cheap on 1,300 players.
 *
 * Slot order in `slots` is the preference for direct seating (dedicated slots
 * before F before Util), so a flex seat is only used when no dedicated seat
 * is free — that keeps the per-slot averages ("average C", "average Util")
 * meaningful for the team-strength baseline.
 */
export function fillSlots<P extends FillablePlayer, S extends string>(
  orderedPlayers: readonly P[],
  slots: readonly SlotSpec<S>[],
): FillResult<P, S> {
  const bySlot = new Map<S, P[]>(slots.map((s) => [s.slot, [] as P[]]));
  const capacity = new Map<S, number>(slots.map((s) => [s.slot, s.capacity]));
  const slotOf = new Map<number, S>();
  const unassigned: P[] = [];

  const accepts = (spec: SlotSpec<S>, positions: readonly Position[]) =>
    positions.some((pos) => spec.accepts.includes(pos));
  const hasRoom = (slot: S) =>
    (bySlot.get(slot)?.length ?? 0) < (capacity.get(slot) ?? 0);

  for (const player of orderedPlayers) {
    const entry = slots.filter((s) => accepts(s, player.positions));
    if (entry.length === 0) {
      unassigned.push(player);
      continue;
    }
    const direct = entry.find((s) => hasRoom(s.slot));
    if (direct) {
      bySlot.get(direct.slot)!.push(player);
      slotOf.set(player.id, direct.slot);
      continue;
    }

    // BFS over slot types. parent[t] = (s, mover): moving `mover` from s to t
    // frees one seat in s.
    const parent = new Map<S, { from: S; mover: P } | null>();
    const queue: S[] = [];
    for (const s of entry) {
      parent.set(s.slot, null);
      queue.push(s.slot);
    }
    let freed: S | null = null;
    while (queue.length > 0 && freed === null) {
      const from = queue.shift()!;
      for (const occupant of bySlot.get(from)!) {
        for (const spec of slots) {
          if (parent.has(spec.slot)) continue;
          if (!accepts(spec, occupant.positions)) continue;
          parent.set(spec.slot, { from, mover: occupant });
          if (hasRoom(spec.slot)) {
            freed = spec.slot;
            break;
          }
          queue.push(spec.slot);
        }
        if (freed !== null) break;
      }
    }

    if (freed === null) {
      unassigned.push(player);
      continue;
    }

    // Walk the path back: each mover steps into the seat freed ahead of it.
    let target: S = freed;
    for (;;) {
      const link = parent.get(target);
      if (!link) break;
      const fromList = bySlot.get(link.from)!;
      fromList.splice(fromList.indexOf(link.mover), 1);
      bySlot.get(target)!.push(link.mover);
      slotOf.set(link.mover.id, target);
      target = link.from;
    }
    bySlot.get(target)!.push(player);
    slotOf.set(player.id, target);
  }

  return { slotOf, bySlot, unassigned };
}
