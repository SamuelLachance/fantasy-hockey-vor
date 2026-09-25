/**
 * Draft-board and roster helpers on top of dynasty.json (§7), for the /league
 * page and the terminal report. Pure: the caller passes the snapshot, the
 * available ids and the league signals.
 *
 * - Value on the board = max(0, DV[mode]) + NEED_BONUS · need_g · max(0, E[G_0])
 *   (the need bonus only touches the current season).
 * - Availability ranks players by a market rank: the geometric mean of the
 *   Ros% rank and the ADP rank among the still-available players (whichever
 *   exists; Ros ties share the average rank, ADP ≥ 285 counts as missing).
 *   Every pick now lands in this pool (prospects included), so the pool share
 *   of picks is 1.
 * - Drop protection keeps keeper-core players, free stashes worth ≥ 15
 *   long-term and the team's 12 best by balanced value.
 */
import { availability, NEED_BONUS } from "../fantrax/draft";
import type { DynastyRecord, DynastySnapshot, Group, Mode } from "./types";

export const ADP_MISSING = 285;
export const PROTECT_TOP_N = 12;
export const PROTECT_FREE_MIN_LT = 15;

/** Average ranks (1-based) of the values, larger = better when `desc`. */
function averageRanks(entries: Array<[string, number]>, desc: boolean): Map<string, number> {
  const sorted = [...entries].sort((a, b) => (desc ? b[1] - a[1] : a[1] - b[1]) || a[0].localeCompare(b[0]));
  const out = new Map<string, number>();
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1]![1] === sorted[i]![1]) j++;
    for (let k = i; k <= j; k++) out.set(sorted[k]![0], (i + j) / 2 + 1);
    i = j + 1;
  }
  return out;
}

/**
 * Market rank among `ids`: exp(mean(ln rank_ros, ln rank_adp)) over the
 * signals that exist; players with neither signal are left out (rank last).
 */
export function marketRanks(
  ids: readonly string[],
  ros: (id: string) => number | undefined,
  adp: (id: string) => number | undefined,
): Map<string, number> {
  const rosRank = averageRanks(
    ids.map((id) => [id, ros(id) ?? 0] as [string, number]).filter(([, r]) => r > 0),
    true,
  );
  const adpRank = averageRanks(
    ids.map((id) => [id, adp(id) ?? Infinity] as [string, number]).filter(([, a]) => a < ADP_MISSING),
    false,
  );
  const combined: Array<[string, number]> = [];
  for (const id of ids) {
    const rs = [rosRank.get(id), adpRank.get(id)].filter((x): x is number => x != null);
    if (!rs.length) continue;
    combined.push([id, Math.exp(rs.reduce((s, r) => s + Math.log(r), 0) / rs.length)]);
  }
  // re-rank the combined score so ranks are 1..n
  return averageRanks(combined, false);
}

export function dynastyDraftValue(rec: DynastyRecord, mode: Mode, need = 0): number {
  return Math.max(0, rec.dv[mode]) + NEED_BONUS * need * Math.max(0, rec.eG[0] ?? 0);
}

export interface DynastyBoardRow {
  id: string;
  g: Group;
  value: number;
  dv: number;
  marketRank: number | null;
  /** P(still available at my next pick) and at my following pick. */
  available: number;
  availableFollowing: number | null;
}

export interface DynastyBoardOptions {
  mode: Mode;
  /** Empty-slot need weights for D and G (0..1). */
  need?: Partial<Record<"D" | "G", number>>;
  /** Other teams' picks before my next / following pick (null: no pick). */
  picksBefore: number | null;
  picksBeforeFollowing?: number | null;
  limit?: number;
}

/** Best available by dynasty value, with the odds each one is still there. */
export function dynastyBoard(
  dynasty: DynastySnapshot,
  availableIds: readonly string[],
  opts: DynastyBoardOptions,
): DynastyBoardRow[] {
  const ids = availableIds.filter((id) => dynasty.players[id]);
  const ranks = marketRanks(
    ids,
    (id) => dynasty.players[id]!.market.ros,
    (id) => dynasty.players[id]!.market.adp,
  );
  const ranked = ranks.size;
  const odds = (rank: number | null, m: number | null | undefined) =>
    m == null ? null : availability(rank, m, 1, Math.max(1, ranked));
  const rows = ids.map((id) => {
    const r = dynasty.players[id]!;
    const need = r.g === "D" ? (opts.need?.D ?? 0) : r.g === "G" ? (opts.need?.G ?? 0) : 0;
    const mr = ranks.get(id) ?? null;
    return {
      id,
      g: r.g,
      value: dynastyDraftValue(r, opts.mode, need),
      dv: r.dv[opts.mode],
      marketRank: mr,
      available: odds(mr, opts.picksBefore) ?? 1,
      availableFollowing: odds(mr, opts.picksBeforeFollowing),
    };
  });
  rows.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}

export interface DropProtection {
  protected: Set<string>;
  /** Unprotected roster ids, least valuable first (balanced DV). */
  order: string[];
}

/** Which roster players must never be suggested as drops. */
export function dynastyDropProtection(
  rosterIds: readonly string[],
  dynasty: DynastySnapshot,
  core: ReadonlySet<string> = new Set(),
): DropProtection {
  const dvOf = (id: string) => dynasty.players[id]?.dv.balanced ?? 0;
  const best = [...rosterIds].sort((a, b) => dvOf(b) - dvOf(a) || a.localeCompare(b)).slice(0, PROTECT_TOP_N);
  const prot = new Set<string>([...core, ...best]);
  for (const id of rosterIds) {
    const r = dynasty.players[id];
    if (!r) continue;
    if (r.keeper.status === "core") prot.add(id);
    if (r.keeper.status === "free" && r.dv.longTerm >= PROTECT_FREE_MIN_LT) prot.add(id);
  }
  const order = rosterIds.filter((id) => !prot.has(id)).sort((a, b) => dvOf(a) - dvOf(b) || a.localeCompare(b));
  return { protected: prot, order };
}
