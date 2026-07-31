import type { ReactNode } from "react";
import { Fragment } from "react";
import { foldSearchTextWithMap } from "@/lib/search-fold";

/** Keep search highlight + input maxLength in sync. */
export const HIGHLIGHT_QUERY_MAX = 48;

/** Show length counter this many chars before the hard max. */
export const SEARCH_NEAR_CAP_REMAINING = 8;

/** Whether the toolbar should show the search length counter. */
export function searchQueryNearCap(
  length: number,
  max = HIGHLIGHT_QUERY_MAX,
  warnWithin = SEARCH_NEAR_CAP_REMAINING,
): boolean {
  return length >= max - warnWithin;
}

/** Compact `current/max` counter for the search field. */
export function searchQueryLengthLabel(
  length: number,
  max = HIGHLIGHT_QUERY_MAX,
): string {
  return `${length}/${max}`;
}

/** Accessible name for the board search input. */
export function searchFieldAriaLabel(): string {
  return "Search players or teams";
}

/** Tooltip for the board search input. */
export function searchFieldTitle(): string {
  return "Search players or teams (/)";
}

/** Placeholder for the board search input. */
export function searchFieldPlaceholder(): string {
  return "Search players or teams...";
}

/** Accessible name for the clear-search control. */
export function clearSearchAriaLabel(): string {
  return "Clear search";
}

/** Tooltip for the clear-search control. */
export function clearSearchTitle(): string {
  return "Clear search (Esc)";
}

/** True when Clear / Esc should wipe the search field (includes whitespace-only). */
export function searchQueryIsClearable(query: string): boolean {
  return query.length > 0;
}

/** Case- and accent-insensitive highlight of every `query` occurrence. */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim().slice(0, HIGHLIGHT_QUERY_MAX);
  if (!q) return text;
  const { folded, map } = foldSearchTextWithMap(text);
  const needle = foldSearchTextWithMap(q).folded;
  if (!needle || !folded.includes(needle)) return text;

  const parts: ReactNode[] = [];
  let startOrig = 0;
  let foldedStart = 0;
  let idx = folded.indexOf(needle, foldedStart);
  let key = 0;
  while (idx >= 0) {
    const matchOrigStart = map[idx]!;
    const matchOrigEndExclusive =
      idx + needle.length < map.length
        ? map[idx + needle.length]!
        : text.length;
    if (matchOrigStart > startOrig) {
      parts.push(text.slice(startOrig, matchOrigStart));
    }
    parts.push(
      <mark
        key={`h-${key++}`}
        className="rounded-sm bg-cyan-500/25 px-0.5 text-inherit"
      >
        {text.slice(matchOrigStart, matchOrigEndExclusive)}
      </mark>,
    );
    startOrig = matchOrigEndExclusive;
    foldedStart = idx + needle.length;
    idx = folded.indexOf(needle, foldedStart);
  }
  if (startOrig < text.length) parts.push(text.slice(startOrig));
  return <Fragment>{parts}</Fragment>;
}
