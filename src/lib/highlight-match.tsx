import type { ReactNode } from "react";
import { Fragment } from "react";

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

/** Placeholder for the board search input. */
export function searchFieldPlaceholder(): string {
  return "Search players or teams...";
}

/** Accessible name for the clear-search control. */
export function clearSearchAriaLabel(): string {
  return "Clear search";
}

/** Case-insensitive highlight of every `query` occurrence inside `text`. */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim().slice(0, HIGHLIGHT_QUERY_MAX);
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  if (!lower.includes(needle)) return text;

  const parts: ReactNode[] = [];
  let start = 0;
  let idx = lower.indexOf(needle, start);
  let key = 0;
  while (idx >= 0) {
    if (idx > start) parts.push(text.slice(start, idx));
    parts.push(
      <mark
        key={`h-${key++}`}
        className="rounded-sm bg-cyan-500/25 px-0.5 text-inherit"
      >
        {text.slice(idx, idx + needle.length)}
      </mark>,
    );
    start = idx + needle.length;
    idx = lower.indexOf(needle, start);
  }
  if (start < text.length) parts.push(text.slice(start));
  return <Fragment>{parts}</Fragment>;
}
