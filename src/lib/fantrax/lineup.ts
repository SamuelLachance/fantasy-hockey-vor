/**
 * Daily lineup optimizer: a maximum-weight assignment of candidates to the
 * 15 active slot instances (C3 W5 F1 D3 Skt1 G2), solved exactly with the
 * Hungarian algorithm (≤ ~40 × 30, well under a millisecond).
 *
 * The captain is not a separate decision: whoever the assignment puts in
 * the Skt slot is the captain, because his value there (×1.5 offense, and
 * no Blk/Tk/SHO for a D) competes with every other placement.
 */
import { DEFAULT_SLOT_COUNTS, SLOT_ORDER, type SlotId } from "./config";

export interface LineupCandidate {
  id: string;
  /** Slots the player may fill (Fantrax `eligiblePos` tokens). */
  eligible: readonly SlotId[];
  /** ACTIVE / RESERVE / MINORS / INJURED_RESERVE (or "FA"/"WW" for what-ifs). */
  status: string;
  /** Current slot for ACTIVE players. */
  currentSlot?: string;
  /** Expected points in each eligible slot for the period (0 = no game / out). */
  values: Partial<Record<SlotId, number>>;
}

export interface LineupAssignment {
  slot: SlotId;
  playerId: string | null;
  value: number;
}

export interface LineupMove {
  id: string;
  /** Current slot (ACTIVE) or roster status. */
  from: string;
  to: SlotId | "RESERVE";
}

export interface LineupResult {
  assignments: LineupAssignment[];
  total: number;
  captain: { id: string; value: number; gain: number } | null;
  moves: LineupMove[];
}

/** Slot tokens a player can fill, from Fantrax `eligiblePos`. */
export function eligibleSlots(eligiblePos: string): SlotId[] {
  const tokens = new Set(eligiblePos.split(",").map((t) => t.trim()));
  return SLOT_ORDER.filter((s) => tokens.has(s));
}

/**
 * Hungarian algorithm (Kuhn–Munkres with potentials, O(n²m)), minimizing
 * total cost. Requires rows ≤ columns; returns the column of each row.
 */
export function hungarianMin(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  if (m < n) throw new Error("hungarianMin needs rows <= columns");
  const INF = Number.POSITIVE_INFINITY;
  const u = new Float64Array(n + 1);
  const v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1);
  const way = new Int32Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(m + 1).fill(INF);
    const used = new Uint8Array(m + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;
      const row = cost[i0 - 1]!;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = row[j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const out = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) if (p[j]! > 0) out[p[j]! - 1] = j - 1;
  return out;
}

const FORBIDDEN = 1e9;

/**
 * Tiny tie-breaks so equal-value lineups prefer fewer moves: keep ACTIVE
 * players (in their current slot first), then RESERVE, before promoting
 * from Minors/IR. Far below any real point difference.
 */
function stayBonus(c: LineupCandidate, slot: SlotId): number {
  if (c.status === "ACTIVE") return c.currentSlot === slot ? 3e-6 : 2e-6;
  if (c.status === "RESERVE") return 1e-6;
  return 0;
}

/** Best value a player gets outside the Skt slot. */
export function bestNonCaptainValue(c: LineupCandidate): number {
  let best = 0;
  for (const s of c.eligible) if (s !== "Skt") best = Math.max(best, c.values[s] ?? 0);
  return best;
}

/** What playing the captain slot adds over the player's best other slot. */
export function captainGain(c: LineupCandidate): number {
  if (!c.eligible.includes("Skt")) return 0;
  return (c.values.Skt ?? 0) - bestNonCaptainValue(c);
}

export function optimizeLineup(
  candidates: LineupCandidate[],
  slotCounts: Record<SlotId, number> = DEFAULT_SLOT_COUNTS,
): LineupResult {
  const rows: SlotId[] = [];
  for (const s of SLOT_ORDER) for (let k = 0; k < (slotCounts[s] ?? 0); k++) rows.push(s);
  // Columns: every candidate, then one "leave empty" column per slot row.
  const cols = candidates.length + rows.length;
  const cost = rows.map((slot) => {
    const row = new Array<number>(cols).fill(0);
    candidates.forEach((c, j) => {
      row[j] = c.eligible.includes(slot) ? -((c.values[slot] ?? 0) + stayBonus(c, slot)) : FORBIDDEN;
    });
    return row;
  });
  const pick = hungarianMin(cost);

  const assignments: LineupAssignment[] = rows.map((slot, i) => {
    const j = pick[i]!;
    const c = j < candidates.length ? candidates[j]! : null;
    return { slot, playerId: c ? c.id : null, value: c ? (c.values[slot] ?? 0) : 0 };
  });
  const total = assignments.reduce((s, a) => s + a.value, 0);

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const cap = assignments.find((a) => a.slot === "Skt" && a.playerId);
  const captain = cap?.playerId
    ? { id: cap.playerId, value: cap.value, gain: captainGain(byId.get(cap.playerId)!) }
    : null;

  const moves: LineupMove[] = [];
  const placed = new Set<string>();
  for (const a of assignments) {
    if (!a.playerId) continue;
    placed.add(a.playerId);
    const c = byId.get(a.playerId)!;
    if (c.status === "ACTIVE" && c.currentSlot === a.slot) continue;
    moves.push({ id: c.id, from: c.status === "ACTIVE" ? (c.currentSlot ?? "ACTIVE") : c.status, to: a.slot });
  }
  for (const c of candidates) {
    if (c.status === "ACTIVE" && !placed.has(c.id)) {
      moves.push({ id: c.id, from: c.currentSlot ?? "ACTIVE", to: "RESERVE" });
    }
  }
  return { assignments, total, captain, moves };
}

/**
 * Best lineup total with `id` forced into the Skt slot (null = Skt left
 * empty): he may play nowhere else and nobody else may play Skt, so the
 * regular slots are re-filled around the choice.
 */
export function totalWithCaptain(
  candidates: LineupCandidate[],
  id: string | null,
  slotCounts: Record<SlotId, number> = DEFAULT_SLOT_COUNTS,
): number {
  const forced = candidates.map((c): LineupCandidate => {
    if (c.id === id) return { ...c, eligible: c.eligible.includes("Skt") ? ["Skt"] : [] };
    return { ...c, eligible: c.eligible.filter((s) => s !== "Skt") };
  });
  return optimizeLineup(forced, slotCounts).total;
}

export interface CaptainOption {
  id: string;
  /** Best lineup total with him as captain. */
  total: number;
  /** `total` minus the optimal lineup's total (0 for the best choice). */
  delta: number;
  /** Isolated ×1.5 gain over his best other slot (context only). */
  gain: number;
  value: number;
}

/**
 * Captain ranking by what the whole lineup scores with each Skt-eligible
 * candidate as captain. Ranking by the isolated Skt gain would ignore who
 * fills the slot he leaves: a top C with no C depth behind him is worth
 * more at C than at Skt.
 */
export function captainRanking(
  candidates: LineupCandidate[],
  limit = 5,
  slotCounts: Record<SlotId, number> = DEFAULT_SLOT_COUNTS,
): CaptainOption[] {
  const best = optimizeLineup(candidates, slotCounts).total;
  return candidates
    .filter((c) => c.eligible.includes("Skt") && (c.values.Skt ?? 0) > 0)
    .map((c) => {
      const total = totalWithCaptain(candidates, c.id, slotCounts);
      return { id: c.id, total, delta: Math.min(0, total - best), gain: captainGain(c), value: c.values.Skt ?? 0 };
    })
    .sort((a, b) => b.total - a.total || b.gain - a.gain)
    .slice(0, limit);
}
