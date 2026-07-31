"use client";

import { startTransition, type KeyboardEvent } from "react";
import { CircleHelp, Download, Filter, Link2, X } from "lucide-react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import { downloadTextFile } from "@/lib/rankings-csv";
import {
  rankingsCsvString,
  rankingsJsonString,
} from "@/lib/rankings-export";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import { copyText } from "@/lib/clipboard";
import { rankingsUrlSearch } from "@/lib/rankings-url";

const POSITIONS: Array<Position | "ALL"> = ["ALL", "C", "LW", "RW", "D", "G"];

interface RankingsToolbarProps {
  position: Position | "ALL";
  setPosition: (pos: Position | "ALL") => void;
  query: string;
  setQuery: (q: string) => void;
  deferredQuery: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  pathname: string;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  activeFilterCount: number;
  filtered: PlayerProjection[];
  tableCategories: readonly Category[];
  linkCopied: boolean;
  onLinkCopied: () => void;
  expandedId: number | null;
  hideDepthGoalies: boolean;
  setHideDepthGoalies: (v: boolean | ((prev: boolean) => boolean)) => void;
  showDepthToggle: boolean;
  onOpenHelp: () => void;
  statRanges: StatRanges;
}

export function RankingsToolbar({
  position,
  setPosition,
  query,
  setQuery,
  deferredQuery,
  sortKey,
  sortDir,
  pathname,
  filtersOpen,
  setFiltersOpen,
  activeFilterCount,
  filtered,
  tableCategories,
  linkCopied,
  onLinkCopied,
  expandedId,
  hideDepthGoalies,
  setHideDepthGoalies,
  showDepthToggle,
  onOpenHelp,
  statRanges,
}: RankingsToolbarProps) {
  function onPositionTabKeyDown(e: KeyboardEvent, index: number) {
    if (
      e.key !== "ArrowRight" &&
      e.key !== "ArrowLeft" &&
      e.key !== "Home" &&
      e.key !== "End"
    ) {
      return;
    }
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % POSITIONS.length;
    else if (e.key === "ArrowLeft")
      next = (index - 1 + POSITIONS.length) % POSITIONS.length;
    else if (e.key === "Home") next = 0;
    else next = POSITIONS.length - 1;
    startTransition(() => setPosition(POSITIONS[next]!));
    const tabs = (
      e.currentTarget.parentElement as HTMLElement | null
    )?.querySelectorAll('[role="tab"]');
    const el = tabs?.[next] as HTMLElement | undefined;
    el?.focus();
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div
        className="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Filter by position"
      >
        {POSITIONS.map((pos, index) => (
          <button
            key={pos}
            type="button"
            role="tab"
            aria-selected={position === pos}
            tabIndex={position === pos ? 0 : -1}
            onClick={() => startTransition(() => setPosition(pos))}
            onKeyDown={(e) => onPositionTabKeyDown(e, index)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              position === pos
                ? "bg-cyan-500 text-slate-950"
                : "bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            {pos}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-col gap-2 sm:max-w-xl sm:flex-row">
        <div className="relative w-full">
          <input
            type="search"
            aria-label="Search players or teams"
            placeholder="Search players or teams..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 pr-10 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 focus-visible:ring-cyan-300/70"
          />
          {query.trim() !== "" && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-500 transition hover:bg-white/10 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFiltersOpen((o) => !o)}
          className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
            filtersOpen || activeFilterCount > 0
              ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
              : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
          }`}
        >
          <Filter className="h-4 w-4" />
          Stats
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-xs font-bold text-slate-950">
              {activeFilterCount}
            </span>
          )}
        </button>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => {
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile(
              `vor-rankings-${position.toLowerCase()}-${stamp}.csv`,
              rankingsCsvString(filtered, position, tableCategories),
              "text/csv;charset=utf-8",
            );
          }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          title="Download filtered rankings as CSV"
        >
          <Download className="h-4 w-4" />
          CSV
        </button>
        <button
          type="button"
          disabled={filtered.length === 0}
          onClick={() => {
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile(
              `vor-rankings-${position.toLowerCase()}-${stamp}.json`,
              rankingsJsonString(filtered, position),
              "application/json;charset=utf-8",
            );
          }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:cursor-not-allowed disabled:opacity-40"
          title="Download filtered rankings as JSON"
        >
          JSON
        </button>
        <button
          type="button"
          onClick={() => {
            const qs = rankingsUrlSearch({
              position,
              query: deferredQuery,
              sortKey,
              sortDir,
              playerId: expandedId,
              hideDepthGoalies,
              statRanges,
            });
            const url = `${window.location.origin}${pathname}${qs ? `?${qs}` : ""}`;
            void copyText(url).then((ok) => {
              if (ok) onLinkCopied();
            });
          }}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          title="Copy link to this board view"
        >
          <Link2 className="h-4 w-4" />
          {linkCopied ? "Copied" : "Link"}
        </button>
        {showDepthToggle && (
          <button
            type="button"
            aria-pressed={hideDepthGoalies}
            onClick={() => startTransition(() => setHideDepthGoalies((v) => !v))}
            className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              hideDepthGoalies
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
            title="Hide org-depth goalies at 4–8 GP"
          >
            {hideDepthGoalies ? "Starters" : "All G"}
          </button>
        )}
        <button
          type="button"
          onClick={onOpenHelp}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export { POSITIONS };
