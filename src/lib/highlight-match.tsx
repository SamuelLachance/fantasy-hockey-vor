import type { ReactNode } from "react";
import { Fragment } from "react";

/** Case-insensitive highlight of every `query` occurrence inside `text`. */
export function highlightMatch(text: string, query: string): ReactNode {
  const q = query.trim();
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
