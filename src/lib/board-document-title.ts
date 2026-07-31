import type { Position } from "@/lib/types";
import { PROJECTION_SEASON } from "@/lib/nhl-api";

const BASE_TITLE = `Fantasy Hockey VOR | ${PROJECTION_SEASON} ML Rankings`;
const BRAND = "Fantasy Hockey VOR";

/** Tab title reflecting board position / search / expanded player. */
export function boardDocumentTitle(opts: {
  position: Position | "ALL";
  query: string;
  playerName?: string | null;
}): string {
  const parts: string[] = [];
  if (opts.playerName?.trim()) parts.push(opts.playerName.trim());
  if (opts.position !== "ALL") parts.push(opts.position);
  const q = opts.query.trim();
  if (q) {
    parts.push(`“${q.length > 24 ? `${q.slice(0, 23)}…` : q}”`);
  }
  if (parts.length === 0) return BASE_TITLE;
  return `${BRAND} · ${parts.join(" · ")}`;
}
