/**
 * Flex-aware seat fill: augmenting paths and exact optimality.
 * Run: npx tsx scripts/test-slot-fill.ts
 */
import assert from "node:assert/strict";
import { fillSlots, type SlotSpec } from "../src/lib/leagues/slot-fill";
import type { Position } from "../src/lib/types";

type P = { id: number; positions: Position[]; value: number };

// 1. A C/LW seated at C must slide to LW when a pure C arrives.
{
  const slots: SlotSpec<string>[] = [
    { slot: "C", capacity: 1, accepts: ["C"] },
    { slot: "LW", capacity: 1, accepts: ["LW"] },
  ];
  const players: P[] = [
    { id: 1, positions: ["C", "LW"], value: 10 },
    { id: 2, positions: ["C"], value: 9 },
    { id: 3, positions: ["LW"], value: 8 },
  ];
  const r = fillSlots(players, slots);
  assert.equal(r.slotOf.get(1), "LW", "multi-eligible moved to LW");
  assert.equal(r.slotOf.get(2), "C");
  assert.deepEqual(r.unassigned.map((p) => p.id), [3], "pure LW left out");
}

// 2. Two-step path: C → F → Util chain frees a seat for a D.
{
  const slots: SlotSpec<string>[] = [
    { slot: "C", capacity: 1, accepts: ["C"] },
    { slot: "F", capacity: 1, accepts: ["C", "LW", "RW"] },
    { slot: "D", capacity: 1, accepts: ["D"] },
    { slot: "Util", capacity: 1, accepts: ["C", "LW", "RW", "D"] },
  ];
  const players: P[] = [
    { id: 1, positions: ["D"], value: 10 },
    { id: 2, positions: ["D"], value: 9 }, // → Util
    { id: 3, positions: ["C"], value: 8 }, // → C
    { id: 4, positions: ["C"], value: 7 }, // → F
    { id: 5, positions: ["LW"], value: 6 }, // no seat left
  ];
  const r = fillSlots(players, slots);
  assert.equal(r.slotOf.get(2), "Util", "second D takes Util");
  assert.equal(r.slotOf.get(4), "F", "second C takes F");
  assert.deepEqual(r.unassigned.map((p) => p.id), [5]);
}

// 3. Greedy + augmenting paths = max-weight seating (brute force check).
function bruteForceBest(players: P[], slots: SlotSpec<string>[]): number {
  let best = 0;
  const n = players.length;
  const seats: string[] = slots.flatMap((s) => Array(s.capacity).fill(s.slot));
  const accepts = new Map(slots.map((s) => [s.slot, s.accepts]));
  const canSeat = (subset: P[]): boolean => {
    // Bipartite matching by DFS (Kuhn).
    const seatOwner = new Array<number>(seats.length).fill(-1);
    const tryPlace = (i: number, seen: boolean[]): boolean => {
      for (let s = 0; s < seats.length; s++) {
        if (seen[s]) continue;
        if (!subset[i]!.positions.some((pos) => accepts.get(seats[s]!)!.includes(pos))) continue;
        seen[s] = true;
        if (seatOwner[s] === -1 || tryPlace(seatOwner[s]!, seen)) {
          seatOwner[s] = i;
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < subset.length; i++) {
      if (!tryPlace(i, new Array(seats.length).fill(false))) return false;
    }
    return true;
  };
  for (let mask = 0; mask < 1 << n; mask++) {
    const subset = players.filter((_, i) => mask & (1 << i));
    const total = subset.reduce((s, p) => s + p.value, 0);
    if (total > best && canSeat(subset)) best = total;
  }
  return best;
}

let seed = 7;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const POS: Position[] = ["C", "LW", "RW", "D"];
const slotsSmall: SlotSpec<string>[] = [
  { slot: "C", capacity: 1, accepts: ["C"] },
  { slot: "LW", capacity: 1, accepts: ["LW"] },
  { slot: "RW", capacity: 1, accepts: ["RW"] },
  { slot: "F", capacity: 1, accepts: ["C", "LW", "RW"] },
  { slot: "D", capacity: 2, accepts: ["D"] },
  { slot: "Util", capacity: 1, accepts: ["C", "LW", "RW", "D"] },
];
for (let trial = 0; trial < 150; trial++) {
  const players: P[] = Array.from({ length: 11 }, (_, i) => {
    const first = POS[Math.floor(rand() * 4)]!;
    const positions: Position[] = [first];
    if (first !== "D" && rand() < 0.4) {
      const second = POS[Math.floor(rand() * 3)]!;
      if (second !== first) positions.push(second);
    }
    return { id: i + 1, positions, value: Math.round(rand() * 1000) / 10 };
  });
  const ordered = [...players].sort((a, b) => b.value - a.value || a.id - b.id);
  const r = fillSlots(ordered, slotsSmall);
  const seated = ordered.filter((p) => r.slotOf.has(p.id));
  const total = seated.reduce((s, p) => s + p.value, 0);
  const best = bruteForceBest(players, slotsSmall);
  assert.ok(Math.abs(total - best) < 1e-9, `trial ${trial}: greedy ${total} vs optimum ${best}`);
  // Capacities respected and every seat legal.
  for (const spec of slotsSmall) {
    const list = r.bySlot.get(spec.slot)!;
    assert.ok(list.length <= spec.capacity, `capacity ${spec.slot}`);
    for (const p of list) {
      assert.ok(p.positions.some((pos) => spec.accepts.includes(pos)), `legal ${spec.slot}`);
    }
  }
}

console.log("OK: slot-fill");
