/**
 * Build-time Snake seed for /league: the verdicts of the players the baked
 * plan shows on first paint (roster, waiver targets, draft board), so their
 * chips render without waiting for `public/snake/fantrax.json`.
 */
import type { SnakeFantraxFile, SnakeSummaryFile } from "./types";

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
