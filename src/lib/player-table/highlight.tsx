import type { ReactNode } from "react";
import { Fragment } from "react";
import { foldSearchTextWithMap } from "@/lib/search-fold";

/** Longest query the highlight looks at. */
export const HIGHLIGHT_QUERY_MAX = 48;

/**
 * Case- and accent-insensitive highlight of every occurrence of each word
 * of `query` in `text` (overlapping hits merge into one mark).
 */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim().slice(0, HIGHLIGHT_QUERY_MAX);
  if (!q) return text;
  const { folded, map } = foldSearchTextWithMap(text);
  const needles = [...new Set(q.split(/\s+/).map((w) => foldSearchTextWithMap(w).folded).filter(Boolean))];
  const spans: Array<[number, number]> = [];
  for (const needle of needles) {
    let idx = folded.indexOf(needle);
    while (idx >= 0) {
      const start = map[idx]!;
      const end = idx + needle.length < map.length ? map[idx + needle.length]! : text.length;
      spans.push([start, end]);
      idx = folded.indexOf(needle, idx + needle.length);
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged: Array<[number, number]> = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1]]);
  }
  const parts: ReactNode[] = [];
  let at = 0;
  merged.forEach(([start, end], i) => {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <mark key={`h-${i}`} className="rounded-sm bg-cyan-500/25 px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <Fragment>{parts}</Fragment>;
}
