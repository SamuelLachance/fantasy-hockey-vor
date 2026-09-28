/**
 * A categories league's whole player list: the draft board inlined in the
 * page, plus its `pool.json` once fetched (every other projected player at
 * his engine rank, then the players on an NHL roster or prospect list with
 * no projection). Pure: no fetch, no React.
 */
import type { SnakeNhlEntry } from "../snake/types";
import type { DraftBoard, DraftBoardPlayer, LeaguePool, NoProjectionKind, UnprojectedPlayer } from "./board-types";

const NO_PROJ: readonly NoProjectionKind[] = ["roster", "prospect"];

/** Shape check of a fetched pool.json (a Pages 404 page or another league's file is refused). */
export function isLeaguePool(raw: unknown, slug: string): raw is LeaguePool {
  const p = raw as Partial<LeaguePool> | null;
  return (
    !!p &&
    typeof p === "object" &&
    p.schema === 1 &&
    p.slug === slug &&
    Array.isArray(p.players) &&
    Array.isArray(p.unprojected) &&
    !!p.snake &&
    typeof p.snake === "object" &&
    p.players.every((x) => !!x && typeof x.id === "number" && typeof x.rank === "number" && Array.isArray(x.pos)) &&
    p.unprojected.every(
      (x) => !!x && typeof x.id === "number" && Array.isArray(x.pos) && x.pos.length > 0 && NO_PROJ.includes(x.noProj),
    )
  );
}

/**
 * An unprojected player as a board row: no line (`proj` / `z` empty), 0
 * value and VOR (never shown: `noProj` says so), `rank` only to order him
 * after every projected player.
 */
export function unprojectedRow(u: UnprojectedPlayer, rank: number): DraftBoardPlayer {
  return {
    id: u.id,
    name: u.name,
    team: u.team,
    pos: u.pos,
    age: u.age,
    gp: 0,
    proj: [],
    z: [],
    value: 0,
    vor: 0,
    vorPos: u.pos[0]!,
    rank,
    posRank: {},
    adp: null,
    noProj: u.noProj,
  };
}

const merged = new WeakMap<LeaguePool, WeakMap<DraftBoard, DraftBoardPlayer[]>>();

/**
 * Everyone, in rank order: the board's rows (hand moves included), the
 * pool's projected rows at their engine ranks (a row the board already has
 * is skipped: a page and a pool from two builds never list a player twice),
 * then the unprojected, roster players before prospects. Built once per
 * board and pool.
 */
export function leaguePlayers(board: DraftBoard, pool: LeaguePool | null): readonly DraftBoardPlayer[] {
  if (!pool) return board.players;
  let byBoard = merged.get(pool);
  let out = byBoard?.get(board);
  if (out) return out;
  const seen = new Set(board.players.map((p) => p.id));
  const projected = [...board.players];
  for (const p of pool.players) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    projected.push(p);
  }
  projected.sort((a, b) => a.rank - b.rank);
  let next = projected.reduce((m, p) => Math.max(m, p.rank), 0);
  out = projected;
  for (const u of pool.unprojected) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    out.push(unprojectedRow(u, ++next));
  }
  if (!byBoard) {
    byBoard = new WeakMap();
    merged.set(pool, byBoard);
  }
  byBoard.set(board, out);
  return out;
}

/** The page's Snake seed (the board's players) plus the pool's verdicts. */
export function leagueSnakeRows(
  seed: Readonly<Record<string, SnakeNhlEntry>> | null,
  pool: LeaguePool | null,
): Readonly<Record<string, SnakeNhlEntry>> | null {
  if (!pool || Object.keys(pool.snake).length === 0) return seed;
  return { ...pool.snake, ...(seed ?? {}) };
}

/** How many players each list holds (the tabs' lead and notes). */
export function leaguePoolCounts(board: DraftBoard, pool: LeaguePool | null): { projected: number; roster: number; prospect: number; total: number } {
  const projected = board.players.length + (pool?.players.length ?? 0);
  const roster = pool?.unprojected.filter((u) => u.noProj === "roster").length ?? 0;
  const prospect = (pool?.unprojected.length ?? 0) - roster;
  return { projected, roster, prospect, total: projected + roster + prospect };
}
