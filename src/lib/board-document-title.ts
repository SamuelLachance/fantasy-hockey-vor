import type { Position } from "@/lib/types";
import { CATEGORY_LABELS } from "@/lib/format";
import { goalieDepthToggleLabel } from "@/lib/goalie-depth-toggle";
import { defaultSortDir, type SortKey } from "@/lib/rankings-filters";
import { SITE_BRAND } from "@/lib/site";
import { siteDefaultTitle } from "@/lib/site-meta";

const BASE_TITLE = siteDefaultTitle();

/** Compact sort token for the tab title; null when VOR desc (board default). */
export function boardSortTitleToken(
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): string | null {
  if (sortKey === "vor" && sortDir === "desc") return null;
  let label: string;
  if (sortKey === "draftValue") label = "Edge";
  else if (sortKey === "sigma") label = "Σσ";
  else if (sortKey === "gamesPlayed") label = "GP";
  else if (sortKey === "rank") label = "#";
  else if (sortKey === "name") label = "Name";
  else if (sortKey === "team") label = "Team";
  else if (sortKey === "vor") label = "VOR";
  else label = CATEGORY_LABELS[sortKey] ?? String(sortKey);

  if (sortDir === defaultSortDir(sortKey)) return label;
  return `${label}${sortDir === "asc" ? "↑" : "↓"}`;
}

/** Compact active-stat-filter token for the tab title. */
export function boardFiltersTitleToken(activeFilterCount: number): string | null {
  if (!(activeFilterCount > 0)) return null;
  return `${activeFilterCount}f`;
}

/** Tab title reflecting board position / search / sort / filters / expanded player. */
export function boardDocumentTitle(opts: {
  position: Position | "ALL";
  query: string;
  playerName?: string | null;
  sortKey?: SortKey;
  sortDir?: "asc" | "desc";
  activeFilterCount?: number;
  showingAllGoalies?: boolean;
}): string {
  const parts: string[] = [];
  if (opts.playerName?.trim()) parts.push(opts.playerName.trim());
  if (opts.position !== "ALL") parts.push(opts.position);
  const q = opts.query.trim();
  if (q) {
    parts.push(`“${q.length > 24 ? `${q.slice(0, 23)}…` : q}”`);
  }
  if (opts.sortKey != null && opts.sortDir != null) {
    const sort = boardSortTitleToken(opts.sortKey, opts.sortDir);
    if (sort) parts.push(sort);
  }
  const filters = boardFiltersTitleToken(opts.activeFilterCount ?? 0);
  if (filters) parts.push(filters);
  // All G — same label as the Starters / All G toolbar control.
  if (opts.showingAllGoalies) {
    parts.push(goalieDepthToggleLabel(false));
  }
  if (parts.length === 0) return BASE_TITLE;
  return `${SITE_BRAND} · ${parts.join(" · ")}`;
}
