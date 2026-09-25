/**
 * Search, filters and sorting for the /snake database (pure).
 */
import { seasonOf, stanceScore } from "./copy";
import { normalizePlayerName } from "./resolve";
import type { SnakeListRow, SnakeStance, SnakeTrend } from "./types";

export type SnakeSort = "opinions" | "recent" | "verdict-pos" | "verdict-neg" | "name";
export type SnakePositionFilter = "" | "F" | "C" | "LW" | "RW" | "D" | "G";

export interface SnakeFilterState {
  query: string;
  verdict: SnakeStance | "";
  trend: SnakeTrend | "";
  position: SnakePositionFilter;
  /** "" = all teams, "-" = no NHL team, else an abbreviation. */
  team: string;
  /** Only players on the user's Fantrax roster. */
  mine: boolean;
  /** Show index into `SnakeIndexFile.shows`, -1 = all. */
  show: number;
  /** "" = all time, "30" / "90" / "365" = last N days, "s:2025-26" = a season. */
  period: string;
  sort: SnakeSort;
}

export const DEFAULT_SNAKE_FILTERS: SnakeFilterState = {
  query: "",
  verdict: "",
  trend: "",
  position: "",
  team: "",
  mine: false,
  show: -1,
  period: "",
  sort: "opinions",
};

/** Days since 1970-01-01 (UTC) for "YYYY-MM-DD". */
export function epochDay(iso: string): number {
  const t = Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  return Math.floor(t / 86_400_000);
}

/** Inclusive epoch-day range for a period filter; null = no restriction. */
export function periodRange(period: string, refIso: string): [number, number] | null {
  if (!period) return null;
  const ref = epochDay(refIso.slice(0, 10));
  if (/^\d+$/.test(period)) return [ref - Number(period) + 1, ref];
  const m = /^s:(\d{4})-\d{2}$/.exec(period);
  if (m) {
    const start = Number(m[1]);
    return [epochDay(`${start}-07-01`), epochDay(`${start + 1}-06-30`)];
  }
  return null;
}

/** Published mentions of `row` in `show` (-1 = any) within `range` (null = any). */
export function mentionCount(row: Pick<SnakeListRow, "m" | "oc">, show: number, range: [number, number] | null): number {
  if (show < 0 && !range) return row.oc;
  const m = row.m ?? [];
  let n = 0;
  for (let i = 0; i + 1 < m.length; i += 2) {
    if (show >= 0 && m[i] !== show) continue;
    const day = m[i + 1]!;
    if (range && (day < range[0] || day > range[1])) continue;
    n++;
  }
  return n;
}

// Folded names are reused on every keystroke / sort comparison.
const foldedNames = new Map<string, string>();
function folded(name: string): string {
  let f = foldedNames.get(name);
  if (f === undefined) {
    f = normalizePlayerName(name);
    if (foldedNames.size > 5_000) foldedNames.clear();
    foldedNames.set(name, f);
  }
  return f;
}

function positionMatches(pos: string | null, filter: SnakePositionFilter): boolean {
  if (!filter) return true;
  if (filter === "F") return pos === "C" || pos === "LW" || pos === "RW" || pos === "F";
  return pos === filter;
}

/** Folded query tokens (accents ignored). */
export function queryTokens(query: string): string[] {
  return normalizePlayerName(query).split(" ").filter(Boolean);
}

export function rowMatchesQuery(row: Pick<SnakeListRow, "n" | "tm">, tokens: readonly string[]): boolean {
  if (tokens.length === 0) return true;
  const name = folded(row.n);
  const team = (row.tm ?? "").toLowerCase();
  return tokens.every((t) => name.includes(t) || (t.length >= 2 && t === team));
}

export interface SnakeFilterContext {
  /** Reference date for "last N days" (the data build date, YYYY-MM-DD…). */
  refDate: string;
  /** Fantrax ids on the user's roster. */
  myFantraxIds: ReadonlySet<string>;
}

export interface SnakeListItem {
  row: SnakeListRow;
  /** Mentions matching the show / period filters (= `row.oc` without them). */
  matches: number;
}

/** Apply every filter; sorting is separate. */
export function filterSnakeRows(
  rows: readonly SnakeListRow[],
  f: SnakeFilterState,
  ctx: SnakeFilterContext,
): SnakeListItem[] {
  const tokens = queryTokens(f.query);
  const range = periodRange(f.period, ctx.refDate);
  const out: SnakeListItem[] = [];
  for (const row of rows) {
    if (f.verdict && row.v !== f.verdict) continue;
    if (f.trend && row.td !== f.trend) continue;
    if (!positionMatches(row.pos, f.position)) continue;
    if (f.team === "-" ? row.tm !== null : f.team && row.tm !== f.team) continue;
    if (f.mine && !(row.fx && ctx.myFantraxIds.has(row.fx))) continue;
    if (!rowMatchesQuery(row, tokens)) continue;
    const matches = mentionCount(row, f.show, range);
    if (matches === 0) continue;
    out.push({ row, matches });
  }
  return out;
}

function byName(a: SnakeListRow, b: SnakeListRow): number {
  const x = folded(a.n);
  const y = folded(b.n);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Sort a filtered list (stable, deterministic ties). */
export function sortSnakeItems(items: readonly SnakeListItem[], sort: SnakeSort): SnakeListItem[] {
  const list = [...items];
  const recent = (a: SnakeListItem, b: SnakeListItem) => (a.row.ls < b.row.ls ? 1 : a.row.ls > b.row.ls ? -1 : 0);
  const count = (a: SnakeListItem, b: SnakeListItem) => b.matches - a.matches || b.row.oc - a.row.oc;
  list.sort((a, b) => {
    switch (sort) {
      case "recent":
        return recent(a, b) || count(a, b) || byName(a.row, b.row);
      case "verdict-pos":
        return stanceScore(b.row.v) - stanceScore(a.row.v) || count(a, b) || byName(a.row, b.row);
      case "verdict-neg":
        return stanceScore(a.row.v) - stanceScore(b.row.v) || count(a, b) || byName(a.row, b.row);
      case "name":
        return byName(a.row, b.row);
      case "opinions":
      default:
        return count(a, b) || recent(a, b) || byName(a.row, b.row);
    }
  });
  return list;
}

/** Seasons with at least one published mention, newest first. */
export function seasonsInRows(rows: readonly Pick<SnakeListRow, "m">[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const m = r.m ?? [];
    for (let i = 1; i < m.length; i += 2) {
      const d = new Date(m[i]! * 86_400_000).toISOString().slice(0, 10);
      set.add(seasonOf(d));
    }
  }
  return [...set].sort().reverse();
}

/** NHL teams present, alphabetical. */
export function teamsInRows(rows: readonly Pick<SnakeListRow, "tm">[]): string[] {
  return [...new Set(rows.map((r) => r.tm).filter((t): t is string => !!t))].sort();
}

/** Number of active filters (search and sort excluded). */
export function activeSnakeFilterCount(f: SnakeFilterState): number {
  return (
    (f.verdict ? 1 : 0) +
    (f.trend ? 1 : 0) +
    (f.position ? 1 : 0) +
    (f.team ? 1 : 0) +
    (f.mine ? 1 : 0) +
    (f.show >= 0 ? 1 : 0) +
    (f.period ? 1 : 0)
  );
}
