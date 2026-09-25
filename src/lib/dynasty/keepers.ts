/**
 * Team-conditional keeper odds (keeper audit 2026-09-25): a rostered
 * player's 2027 cutdown is decided against his own team's 10 keeper slots,
 * not the league-wide 160th keeper. Per simulated path, each team keeps its
 * 10 best keep indices (> 0) among its non-eligible candidates — the current
 * roster plus the rest of the live draft, filled pick by pick with the best
 * available by market rank (Ros% / ADP, as the draft board ranks them).
 *
 * The league-wide status (keeper.status / pKept27) stays the value basis
 * (trade and draft value on a generic roster); this one is the roster view.
 * Pure: the caller passes the per-path keep indices of the 2027 cutdown.
 */
import { marketRanks } from "./board";

export interface TeamKeeperInput {
  /** Fantasy team → rostered player ids. */
  rosters: Record<string, readonly string[]>;
  /** Team of each remaining pick of the live draft, in pick order. */
  remainingPicks: readonly string[];
  /** Unrostered players who can still be drafted (market signals for the fill order). */
  pool: ReadonlyArray<{ id: string; ros?: number; adp?: number }>;
}

export interface TeamKeeperOdds {
  /** P(among his team's 10 keepers | not minors-eligible at the cutdown); null when almost never gated. */
  pKept: number | null;
  /** Median rank among his team's candidates on the paths he is gated. */
  rank: number | null;
  /** Share of paths he takes one of the team's slots. */
  keptShare: number;
}

export interface TeamKeepersResult {
  odds: Map<string, TeamKeeperOdds>;
  /** Per team: expected slots used by the current roster and by the players the rest of the draft adds. */
  teams: Map<string, { roster: number; drafted: number; draftedIds: string[] }>;
}

/**
 * @param ki per player, the keep index at the 2027 cutdown on each path (NaN = eligible on that path)
 * @param slots keeper slots per team (10)
 */
export function teamKeepers(inp: TeamKeeperInput, ki: ReadonlyMap<string, Float64Array>, slots: number): TeamKeepersResult {
  // the rest of the live draft: each remaining pick takes the best available by market rank
  const rostered = new Set(Object.values(inp.rosters).flat());
  const pool = inp.pool.filter((x) => !rostered.has(x.id));
  const byId = new Map(pool.map((x) => [x.id, x]));
  const mr = marketRanks(
    pool.map((x) => x.id),
    (id) => byId.get(id)?.ros,
    (id) => byId.get(id)?.adp,
  );
  const order = [...mr.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([id]) => id);
  const drafted: Record<string, string[]> = {};
  let next = 0;
  for (const team of inp.remainingPicks) {
    if (next >= order.length) break;
    (drafted[team] ??= []).push(order[next++]!);
  }
  const odds = new Map<string, TeamKeeperOdds>();
  const teams = new Map<string, { roster: number; drafted: number; draftedIds: string[] }>();
  for (const [team, ids] of Object.entries(inp.rosters)) {
    const extra = drafted[team] ?? [];
    const cands = [...ids, ...extra].filter((id) => ki.has(id));
    const rows = cands.map((id) => ki.get(id)!);
    const N = rows.length ? rows[0]!.length : 0;
    const gated = new Float64Array(cands.length);
    const kept = new Float64Array(cands.length);
    const ranks: number[][] = cands.map(() => []);
    const order2 = cands.map((_, i) => i);
    const val = new Float64Array(cands.length);
    for (let n = 0; n < N; n++) {
      let m = 0;
      for (let i = 0; i < cands.length; i++) {
        const x = rows[i]![n]!;
        if (Number.isNaN(x)) continue;
        gated[i]++;
        val[i] = x;
        order2[m++] = i;
      }
      const live = order2.slice(0, m).sort((a, b) => val[b]! - val[a]! || a - b);
      live.forEach((i, r) => {
        ranks[i]!.push(r + 1);
        if (r < slots && val[i]! > 0) kept[i]++;
      });
    }
    const extraSet = new Set(extra);
    let roster = 0;
    let fromDraft = 0;
    cands.forEach((id, i) => {
      const share = N ? kept[i]! / N : 0;
      if (extraSet.has(id)) fromDraft += share;
      else roster += share;
      if (extraSet.has(id)) return;
      const rs = ranks[i]!.sort((a, b) => a - b);
      odds.set(id, {
        pKept: N && gated[i]! / N > 0.02 ? kept[i]! / gated[i]! : null,
        rank: rs.length ? rs[(rs.length - 1) >> 1]! : null,
        keptShare: share,
      });
    });
    teams.set(team, { roster, drafted: fromDraft, draftedIds: extra });
  }
  return { odds, teams };
}
