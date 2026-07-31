"use client";

import { X } from "lucide-react";
import { focusBoardSearch } from "@/lib/board-dom";
import {
  HIGHLIGHT_QUERY_MAX,
  clearSearchAriaLabel,
  clearSearchTitle,
  searchFieldAriaLabel,
  searchFieldPlaceholder,
  searchFieldTitle,
  searchQueryIsClearable,
  searchQueryLengthLabel,
  searchQueryNearCap,
} from "@/lib/highlight-match";

interface RankingsSearchFieldProps {
  query: string;
  setQuery: (q: string) => void;
}

/** Board search input with clear control and near-cap length counter. */
export function RankingsSearchField({
  query,
  setQuery,
}: RankingsSearchFieldProps) {
  const nearQueryCap = searchQueryNearCap(query.length);

  function clearSearch() {
    setQuery("");
    queueMicrotask(focusBoardSearch);
  }

  return (
    <div className="relative w-full">
      <input
        type="search"
        inputMode="search"
        enterKeyHint="search"
        aria-label={searchFieldAriaLabel()}
        title={searchFieldTitle()}
        aria-keyshortcuts="Slash"
        aria-describedby={nearQueryCap ? "rankings-search-limit" : undefined}
        autoComplete="off"
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        maxLength={HIGHLIGHT_QUERY_MAX}
        placeholder={searchFieldPlaceholder()}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-base text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus-visible:ring-cyan-300/70"
      />
      {searchQueryIsClearable(query) && (
        <button
          type="button"
          aria-label={clearSearchAriaLabel()}
          title={clearSearchTitle()}
          onClick={clearSearch}
          className="absolute right-1.5 top-1/2 inline-flex min-h-6 min-w-6 -translate-y-1/2 items-center justify-center rounded-md p-1.5 text-slate-500 transition hover:bg-white/10 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {nearQueryCap && (
        <span
          id="rankings-search-limit"
          className="pointer-events-none absolute -bottom-5 right-1 text-[10px] tabular-nums text-slate-500"
        >
          {searchQueryLengthLabel(query.length)}
        </span>
      )}
    </div>
  );
}
