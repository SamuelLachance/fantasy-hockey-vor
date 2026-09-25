/**
 * Build-time Snake seed for /league: the verdicts of the players the baked
 * plan shows on first paint (roster, waiver targets, draft board), so their
 * chips render without waiting for `public/snake/fantrax.json`.
 */
import type { SnakeFantraxFile, SnakeNhlFile, SnakeSummaryFile } from "./types";

interface PlanIds {
  players?: Record<string, unknown>;
  waivers?: { targets?: Array<{ id: string }> };
  draft?: { board?: Array<{ id: string }> } | null;
}

export function snakeFantraxSeed(plan: PlanIds, summary: Pick<SnakeSummaryFile, "rows" | "fx">): SnakeFantraxFile["rows"] {
  const ids = new Set<string>([
    ...Object.keys(plan.players ?? {}),
    ...(plan.waivers?.targets ?? []).map((t) => t.id),
    ...(plan.draft?.board ?? []).map((b) => b.id),
  ]);
  const out: SnakeFantraxFile["rows"] = {};
  for (const id of [...ids].sort()) {
    const key = summary.fx[id];
    const row = key ? summary.rows[key] : undefined;
    if (!key || !row) continue;
    out[id] = [key, row[0], row[1], row[2], row[3]];
  }
  return out;
}

/**
 * Build-time Snake seed for a categories league's board (NHL ids): every
 * board player Snake discussed, so the draft rows' chips need no fetch
 * (the seed is complete for that board).
 */
export function snakeNhlSeed(
  ids: Iterable<number | string>,
  summary: Pick<SnakeSummaryFile, "rows" | "nhl">,
): SnakeNhlFile["rows"] {
  const out: SnakeNhlFile["rows"] = {};
  for (const id of [...new Set([...ids].map(String))].sort()) {
    const key = summary.nhl[id];
    const row = key ? summary.rows[key] : undefined;
    if (!key || !row) continue;
    out[id] = [key, row[0], row[1], row[3]];
  }
  return out;
}

/**
 * A set of numeric ids as a short string (sorted, base-36 gaps joined by
 * "."), for id lists a page carries only to test membership: "8470613" and
 * "8471214" → "51jyt.gp".
 */
export function encodeIdSet(ids: Iterable<number | string>): string {
  const sorted = [...new Set([...ids].map(Number).filter((n) => Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
  return sorted.map((n, i) => (n - (i ? sorted[i - 1]! : 0)).toString(36)).join(".");
}

/** Inverse of `encodeIdSet` (ids as strings, as the JSON files key them). */
export function decodeIdSet(s: string): Set<string> {
  const out = new Set<string>();
  let n = 0;
  for (const part of s ? s.split(".") : []) {
    const gap = parseInt(part, 36);
    if (!Number.isFinite(gap)) continue;
    n += gap;
    out.add(String(n));
  }
  return out;
}
