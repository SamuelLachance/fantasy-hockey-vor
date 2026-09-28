/**
 * Committed snapshot of who the NHL lists today (`src/data/nhl-rosters.json`,
 * `npm run nhl:rosters`): every club's current roster
 * (`api-web.nhle.com/v1/roster/{team}/current`) and prospect list
 * (`/v1/prospects/{team}`), then everyone else the NHL's public player
 * search index ties to a club (`search.d3.nhle.com`, `teamAbbrev`): the
 * prospect lists are empty or nearly so for some clubs (DET, UTA and VAN
 * came back empty in September 2026), so the index fills their AHL, junior,
 * college and European players in. One compact row per player.
 *
 * The categories league boards use it to list the players the projections
 * never saw (rookies, call-ups, players back from Europe or the AHL,
 * prospects) and to show a player's current club. It only ever adds players
 * or corrects a club: the roster endpoint leaves some injured players out,
 * so it must never be used to drop anyone.
 *
 * Pure: no fs, no network (the script does both).
 */
import { NHL_TEAMS } from "./nhl-api";
import type { Position } from "./types";

/**
 * Where the NHL lists him: a club's current roster, its prospect list, or
 * only the search index's club (« org »: in the organisation, on neither
 * list: AHL, junior, college, Europe, long-term injured).
 */
export type NhlListKind = "roster" | "prospect" | "org";

export const NHL_LIST_KINDS: readonly NhlListKind[] = ["roster", "prospect", "org"];

/** Fewer prospects than this on a club's list: the endpoint is likely missing some (warned). */
export const THIN_PROSPECT_LIST = 10;

export interface NhlListedPlayer {
  id: number;
  name: string;
  /** Club abbreviation (the list he is on). */
  team: string;
  /** NHL position code: C, L, R, D or G. */
  code: "C" | "L" | "R" | "D" | "G";
  /** YYYY-MM-DD, null when the NHL gives none. */
  birthDate: string | null;
  list: NhlListKind;
}

export interface NhlRostersFile {
  schema: 1;
  fetchedAt: string;
  source: string;
  /** Players per list, for the sanity checks (`org`: the search index rows, absent in older snapshots). */
  counts: { roster: number; prospect: number; org?: number };
  players: NhlListedPlayer[];
}

interface RawListPlayer {
  id?: unknown;
  firstName?: { default?: unknown };
  lastName?: { default?: unknown };
  positionCode?: unknown;
  birthDate?: unknown;
}

interface RawList {
  forwards?: RawListPlayer[];
  defensemen?: RawListPlayer[];
  goalies?: RawListPlayer[];
}

const CODES = new Set(["C", "L", "R", "D", "G"]);

/** One club list (roster or prospects) → compact rows; malformed entries are skipped. */
export function parseNhlList(raw: unknown, team: string, list: NhlListKind): NhlListedPlayer[] {
  const data = (raw ?? {}) as RawList;
  const out: NhlListedPlayer[] = [];
  for (const p of [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])]) {
    const id = p?.id;
    const first = p?.firstName?.default;
    const last = p?.lastName?.default;
    const code = p?.positionCode;
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
    if (typeof first !== "string" || typeof last !== "string" || typeof code !== "string" || !CODES.has(code)) continue;
    const birth = typeof p.birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.birthDate) ? p.birthDate : null;
    out.push({
      id,
      name: `${first} ${last}`.replace(/\s+/g, " ").trim(),
      team,
      code: code as NhlListedPlayer["code"],
      birthDate: birth,
      list,
    });
  }
  return out;
}

/**
 * Every club's lists merged: one row per player, a roster spot winning over
 * a prospect list (a camp invitee is on both), a prospect list over the
 * search index, then the first club in alphabetical order (a player is on
 * one club's lists; a tie would be an NHL-side glitch). Sorted by id so a
 * refresh diffs row by row.
 */
export function mergeNhlLists(lists: readonly NhlListedPlayer[][]): NhlListedPlayer[] {
  const byId = new Map<number, NhlListedPlayer>();
  const rank = (p: NhlListedPlayer) => NHL_LIST_KINDS.indexOf(p.list);
  for (const p of lists.flat()) {
    const had = byId.get(p.id);
    if (!had || rank(p) < rank(had) || (rank(p) === rank(had) && p.team < had.team)) byId.set(p.id, p);
  }
  return [...byId.values()].sort((a, b) => a.id - b.id);
}

interface RawSearchPlayer {
  playerId?: unknown;
  name?: unknown;
  positionCode?: unknown;
  teamAbbrev?: unknown;
}

/**
 * The NHL's public player search index (`search.d3.nhle.com/api/v1/search/player?q=*`,
 * every player it knows) → one « org » row per player it ties to a club
 * (`teamAbbrev`, active or not: an injured prospect is flagged inactive).
 * Malformed entries and players without a club are skipped; birth dates
 * are not in the index (null).
 */
export function parseNhlSearchIndex(raw: unknown): NhlListedPlayer[] {
  if (!Array.isArray(raw)) return [];
  const teams = new Set<string>(NHL_TEAMS);
  const out: NhlListedPlayer[] = [];
  for (const p of raw as RawSearchPlayer[]) {
    const id = typeof p?.playerId === "string" ? Number(p.playerId) : p?.playerId;
    const team = p?.teamAbbrev;
    const code = p?.positionCode;
    const name = typeof p?.name === "string" ? p.name.replace(/\s+/g, " ").trim() : "";
    if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) continue;
    if (typeof team !== "string" || !teams.has(team)) continue;
    if (typeof code !== "string" || !CODES.has(code) || !name) continue;
    out.push({ id, name, team, code: code as NhlListedPlayer["code"], birthDate: null, list: "org" });
  }
  return out;
}

/** Clubs whose prospect list holds fewer than `THIN_PROSPECT_LIST` players (the endpoint is missing some). */
export function thinProspectClubs(players: readonly NhlListedPlayer[]): string[] {
  const n = new Map<string, number>();
  for (const p of players) if (p.list === "prospect") n.set(p.team, (n.get(p.team) ?? 0) + 1);
  return NHL_TEAMS.filter((t) => (n.get(t) ?? 0) < THIN_PROSPECT_LIST);
}

/** NHL code → the board's position (L → LW, R → RW). */
export function nhlCodePosition(code: NhlListedPlayer["code"]): Position {
  return code === "L" ? "LW" : code === "R" ? "RW" : code;
}

/** Shape errors of a snapshot (empty = valid); `minRoster` guards a half-fetched refresh. */
export function nhlRostersErrors(raw: unknown, minRoster = 600): string[] {
  const f = raw as Partial<NhlRostersFile> | null;
  if (!f || typeof f !== "object") return ["not an object"];
  const errors: string[] = [];
  if (f.schema !== 1) errors.push(`schema ${String(f.schema)}`);
  if (typeof f.fetchedAt !== "string" || Number.isNaN(Date.parse(f.fetchedAt))) errors.push("fetchedAt");
  if (!Array.isArray(f.players)) return [...errors, "players is not an array"];
  const ids = new Set<number>();
  const teams = new Set<string>(NHL_TEAMS);
  let roster = 0;
  for (const p of f.players) {
    if (!p || typeof p.id !== "number" || !(p.id > 0)) {
      errors.push("a row without id");
      continue;
    }
    if (ids.has(p.id)) errors.push(`duplicate id ${p.id}`);
    ids.add(p.id);
    if (typeof p.name !== "string" || !p.name.trim()) errors.push(`${p.id}: name`);
    if (!teams.has(p.team)) errors.push(`${p.id}: team ${String(p.team)}`);
    if (!CODES.has(p.code)) errors.push(`${p.id}: code ${String(p.code)}`);
    if (!NHL_LIST_KINDS.includes(p.list)) errors.push(`${p.id}: list ${String(p.list)}`);
    if (p.list === "roster") roster++;
  }
  if (roster < minRoster) errors.push(`only ${roster} players on NHL rosters (expected ≥ ${minRoster})`);
  return errors;
}

/** One player per line (stable diffs). */
export function serializeNhlRosters(file: NhlRostersFile): string {
  const { players, ...head } = file;
  const rows = players.map((p) => JSON.stringify(p)).join(",\n");
  return `${JSON.stringify(head).slice(0, -1)},"players":[\n${rows}\n]}\n`;
}
