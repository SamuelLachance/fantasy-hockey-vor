/**
 * The live draft board of a salary-cap dynasty league (Slapshot): my roster so
 * far with its cap use over the counted spots, the empty starting seats by
 * position (`seat-needs.ts`, the same fill as the stand-alone draft page: C,
 * the wings as one pool of LW/RW seats, D, G), and the best available
 * players per position by dynasty value. Pure: the component feeds it the
 * table's rows (pool + live rosters and picks + dynasty copy) and the
 * contracts file.
 */
import type { SalaryCapConfig, SlotCounts, SlotId } from "./config";
import type { DynastyMode } from "./dynasty-mode";
import { salaryUsage, type ContractsFile, type SalaryUsage } from "./salary-cap";
import { seatNeeds, type SeatNeedsResult } from "./seat-needs";
import { rowDynastyValue, rowSalary, type FantraxRow } from "./table";

export interface MyDraftPlayer {
  id: string;
  name: string;
  groups: readonly string[];
  /** Roster status (ACTIVE, RESERVE, MINORS, INJURED_RESERVE), or "PICK" for a pick not on the roster yet. */
  status: string;
  /** Dynasty value in the page's mode (null: not valued). */
  dyn: number | null;
  rank: number | null;
  /** Cap hit per season shown (M$), null without a contract. */
  cap: Array<number | null>;
  /** Seasons of `cap` that are signed. */
  signed: number;
  src: FantraxRow["src"];
  /** Season points (league season), the seats' priority; null without a projection. */
  fp: number | null;
  /** Balanced dynasty value, the seats' tie-break (whatever the page's mode). */
  dynB: number | null;
}

export interface DraftBoardView {
  mine: MyDraftPlayer[];
  /** The counted players' cap use (Active + Reserve, picks not placed yet count as Active). */
  salary: SalaryUsage | null;
  /** Cap room left per counted spot still open this season (null when every spot is filled or no cap). */
  roomPerSpot: number | null;
  /** Starting seats: C, the wings as one pool (LW/RW players count on either side), D, G. */
  needs: SeatNeedsResult;
  /** Best available by position, `perGroup` each, by dynasty value in the page's mode (season value without one). */
  best: Array<{ group: string; rows: FantraxRow[] }>;
}

/**
 * My players: the live roster's entries, then my picks that are not on it yet
 * (a pick lands on the roster a moment later); named and valued from the
 * table's rows. `seasons` cap columns (this season first): the dynasty
 * record's contract, else the contracts file (a zero-value player has no
 * record but a real cap hit).
 */
export function myDraftPlayers(
  rows: readonly FantraxRow[],
  roster: ReadonlyArray<{ id: string; status: string }>,
  myPicks: readonly string[],
  mode: DynastyMode,
  seasons = 2,
  contracts: ContractsFile | null = null,
): MyDraftPlayer[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: MyDraftPlayer[] = [];
  const add = (id: string, status: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const r = byId.get(id);
    const c = r?.dynasty?.contract;
    const file = c ? null : (contracts?.players[id] ?? null);
    out.push({
      id,
      name: r?.name ?? r?.dynasty?.n ?? id,
      groups: r?.groups ?? [],
      status,
      dyn: r ? rowDynastyValue(r, mode) : null,
      rank: r?.dynasty?.rank[mode] ?? null,
      cap: Array.from({ length: seasons }, (_, t) => (r && c ? rowSalary(r, t) : (file?.c[t] ?? null))),
      signed: c?.signed ?? file?.s ?? 0,
      src: r?.src ?? "n",
      fp: r?.fp ?? null,
      dynB: r ? rowDynastyValue(r, "balanced") : null,
    });
  };
  for (const e of roster) add(e.id, e.status);
  for (const id of myPicks) add(id, "PICK");
  return out.sort((a, b) => (b.dyn ?? -1) - (a.dyn ?? -1) || a.name.localeCompare(b.name, "fr-CA"));
}

/** Statuses that hold no starting seat this season. */
const OFF_SEAT = new Set(["MINORS", "INJURED_RESERVE"]);

/**
 * The starting seats my players fill (`seat-needs.ts`): Active and Reserve
 * players and picks not placed yet — not the minors or IR — by season points,
 * then balanced dynasty value, then id: the stand-alone page's order.
 */
export function draftSeatNeeds(mine: readonly MyDraftPlayer[], order: readonly SlotId[], counts: SlotCounts): SeatNeedsResult {
  const players = mine
    .filter((p) => !OFF_SEAT.has(p.status))
    .sort((a, b) => (b.fp ?? -1) - (a.fp ?? -1) || (b.dynB ?? -1) - (a.dynB ?? -1) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((p) => ({ id: p.id, pos: p.groups }));
  return seatNeeds(players, Object.fromEntries(order.map((s) => [s, counts[s] ?? 0])));
}

/** Best available at each group: no owner, by dynasty value in the mode (season value to break ties or without one). */
export function bestAvailable(
  rows: readonly FantraxRow[],
  groups: readonly string[],
  mode: DynastyMode,
  perGroup = 3,
): Array<{ group: string; rows: FantraxRow[] }> {
  const free = rows.filter((r) => r.owner === null);
  const key = (r: FantraxRow) => rowDynastyValue(r, mode) ?? -1;
  return groups.map((g) => ({
    group: g,
    rows: free
      .filter((r) => r.groups.includes(g as FantraxRow["groups"][number]))
      .sort((a, b) => key(b) - key(a) || (b.value ?? -1e9) - (a.value ?? -1e9) || a.name.localeCompare(b.name, "fr-CA"))
      .slice(0, perGroup),
  }));
}

/**
 * The whole board. My picks not yet on the roster count as Active for the cap
 * (Fantrax seats a pick in an active slot).
 */
export function draftBoardView(input: {
  rows: readonly FantraxRow[];
  roster: ReadonlyArray<{ id: string; status: string }>;
  myPicks: readonly string[];
  mode: DynastyMode;
  order: readonly SlotId[];
  counts: SlotCounts;
  groups: readonly string[];
  contracts: ContractsFile | null;
  rules: SalaryCapConfig | null;
  perGroup?: number;
}): DraftBoardView {
  const mine = myDraftPlayers(input.rows, input.roster, input.myPicks, input.mode, 2, input.contracts);
  const entries = [
    ...input.roster,
    ...input.myPicks.filter((id) => !input.roster.some((e) => e.id === id)).map((id) => ({ id, status: "ACTIVE" })),
  ];
  // Past the counted spots, the cap counts the best by season points (the
  // players who start now); the rest are expected in the minors.
  const season = new Map(input.rows.map((r) => [r.id, r.fp ?? 0]));
  const salary =
    input.contracts && input.rules
      ? salaryUsage(entries, input.contracts, input.rules, 4, (id) => season.get(id) ?? Number.NEGATIVE_INFINITY)
      : null;
  const open = salary ? salary.spots - salary.counted : 0;
  return {
    mine,
    salary,
    roomPerSpot: salary && open > 0 ? Math.round((salary.room[0]! / open) * 100) / 100 : null,
    needs: draftSeatNeeds(mine, input.order, input.counts),
    best: bestAvailable(input.rows, input.groups, input.mode, input.perGroup ?? 3),
  };
}

export interface StashCandidate {
  id: string;
  name: string;
  status: string;
  /** Cap hit this season (M$): what the move frees. */
  cap: number;
  /** Season points over replacement he would bring as a starter (0 for a prospect or a non-starter). */
  points: number;
  /** Points given up per M$ freed (lower = the better move). */
  perM: number;
  /** Cap charge beyond his points (λ × (cap − minimum) > his points): the model would stash him. */
  netNegative: boolean;
}

/**
 * Counted players (Active + Reserve) whose move to the minors frees cap at
 * the lowest cost in points: his season points over replacement per M$ of
 * cap hit, cheapest first. `netNegative` when his cap charge (λ × salary
 * above the league minimum) outweighs his points — the dynasty model's own
 * rule for stashing a player.
 */
export function stashCandidates(
  rows: readonly FantraxRow[],
  roster: ReadonlyArray<{ id: string; status: string }>,
  rules: SalaryCapConfig,
  contracts: ContractsFile,
  n = 6,
): StashCandidate[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lam = contracts.lambda[0] ?? 0;
  const min = contracts.min[0] ?? 0;
  const out: StashCandidate[] = [];
  for (const e of roster) {
    if (!rules.countedStatuses.includes(e.status)) continue;
    const c = contracts.players[e.id];
    if (!c || !(c.c[0]! > 0)) continue;
    const r = byId.get(e.id);
    const points = Math.max(0, r?.value ?? 0);
    const cap = c.c[0]!;
    out.push({
      id: e.id,
      name: r?.name ?? r?.dynasty?.n ?? e.id,
      status: e.status,
      cap,
      points: Math.round(points),
      perM: Math.round((points / cap) * 10) / 10,
      netNegative: lam * Math.max(0, cap - min) > points,
    });
  }
  return out.sort((a, b) => a.perM - b.perM || b.cap - a.cap || a.name.localeCompare(b.name, "fr-CA")).slice(0, n);
}
