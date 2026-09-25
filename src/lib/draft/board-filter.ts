import { foldSearchText } from "../search-fold";
import type { BoardPosition, DraftBoardPlayer } from "./board-types";
import type { DraftState } from "./draft-state";

export type DraftFilter = "ALL" | BoardPosition;

export const DRAFT_FILTERS: readonly DraftFilter[] = ["ALL", "C", "LW", "RW", "F", "D", "G"];

export function draftFilterLabel(filter: DraftFilter): string {
  return filter === "ALL" ? "Tous" : filter;
}

const FORWARD = new Set(["C", "LW", "RW"]);

export function matchesDraftFilter(p: Pick<DraftBoardPlayer, "pos">, filter: DraftFilter): boolean {
  if (filter === "ALL") return true;
  if (filter === "F") return p.pos.some((x) => FORWARD.has(x));
  return p.pos.includes(filter);
}

/**
 * Punctuation inside names is dropped on both sides, so "jt miller" finds
 * J.T. Miller, "oreilly" / "o’reilly" (iOS smart quote) find O'Reilly and
 * "ekman larsson" finds Ekman-Larsson.
 */
const NAME_PUNCTUATION = /[.'’‘`´ʼ\-‐‑–—]/g;

function foldDraftText(text: string): string {
  return foldSearchText(text).replace(NAME_PUNCTUATION, "");
}

/** Accent- and punctuation-folded; every word must hit the name or the team ("mac col"). */
export function matchesDraftQuery(p: Pick<DraftBoardPlayer, "name" | "team">, query: string): boolean {
  const words = foldDraftText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = `${foldDraftText(p.name)} ${foldDraftText(p.team)}`;
  return words.every((w) => hay.includes(w));
}

export interface DraftRow {
  player: DraftBoardPlayer;
  /** Overall pick number when drafted (1-based), else null. */
  pickNumber: number | null;
  /** Index in `state.picks` (for removal), else -1. */
  pickIndex: number;
  mine: boolean;
}

export function draftRows(
  players: readonly DraftBoardPlayer[],
  state: DraftState,
  opts: { filter: DraftFilter; query: string; showDrafted: boolean },
): DraftRow[] {
  const pickAt = new Map<number, number>();
  state.picks.forEach((p, i) => {
    if (p.id !== 0) pickAt.set(p.id, i);
  });
  const rows: DraftRow[] = [];
  for (const player of players) {
    const idx = pickAt.get(player.id);
    const drafted = idx != null;
    if (drafted && !opts.showDrafted) continue;
    if (!matchesDraftFilter(player, opts.filter)) continue;
    if (!matchesDraftQuery(player, opts.query)) continue;
    rows.push({
      player,
      pickNumber: drafted ? idx + 1 : null,
      pickIndex: drafted ? idx : -1,
      mine: drafted ? state.picks[idx]!.mine : false,
    });
  }
  return rows;
}

/** Rank shown in the first column: position rank under a position filter. */
export function displayRank(p: DraftBoardPlayer, filter: DraftFilter): number {
  if (filter === "ALL") return p.rank;
  return p.posRank[filter] ?? p.rank;
}
