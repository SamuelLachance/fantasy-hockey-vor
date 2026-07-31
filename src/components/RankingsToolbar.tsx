"use client";

import { startTransition, useState } from "react";
import { CircleHelp, Download, Filter, Link2, X } from "lucide-react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import {
  downloadRankingsCsv,
  downloadRankingsJson,
} from "@/lib/rankings-export";
import { HIGHLIGHT_QUERY_MAX } from "@/lib/highlight-match";
import { GOALIE_DEPTH_MAX_GP } from "@/lib/goalie-depth";
import { PositionFilterTabs } from "./PositionFilterTabs";

interface RankingsToolbarProps {
  position: Position | "ALL";
  setPosition: (pos: Position | "ALL") => void;
  query: string;
  setQuery: (q: string) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  activeFilterCount: number;
  filtered: PlayerProjection[];
  tableCategories: readonly Category[];
  linkCopied: boolean;
  linkCopyFailed?: boolean;
  onCopyBoardLink: () => void;
  hideDepthGoalies: boolean;
  setHideDepthGoalies: (v: boolean | ((prev: boolean) => boolean)) => void;
  showDepthToggle: boolean;
  onOpenHelp: () => void;
}

export function RankingsToolbar({
  position,
  setPosition,
  query,
  setQuery,
  filtersOpen,
  setFiltersOpen,
  activeFilterCount,
  filtered,
  tableCategories,
  linkCopied,
  linkCopyFailed = false,
  onCopyBoardLink,
  hideDepthGoalies,
  setHideDepthGoalies,
  showDepthToggle,
  onOpenHelp,
}: RankingsToolbarProps) {
  const [exportFlash, setExportFlash] = useState<"idle" | "csv" | "json">(
    "idle",
  );

  function flashExport(kind: "csv" | "json") {
    setExportFlash(kind);
    window.setTimeout(() => setExportFlash("idle"), 1400);
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <PositionFilterTabs position={position} setPosition={setPosition} />
      <div className="flex w-full flex-col gap-2 sm:max-w-3xl sm:flex-row sm:flex-wrap lg:max-w-none">
        <div className="relative w-full">
          <input
            type="search"
            aria-label="Search players or teams"
            aria-keyshortcuts="Slash"
            maxLength={HIGHLIGHT_QUERY_MAX}
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
          aria-keyshortcuts="f"
          aria-expanded={filtersOpen}
          aria-controls="rankings-stat-filters"
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
        <div
          className="inline-flex shrink-0 overflow-hidden rounded-xl border border-white/10"
          role="group"
          aria-label="Export filtered rankings"
        >
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => {
              downloadRankingsCsv(filtered, position, tableCategories);
              flashExport("csv");
            }}
            className="inline-flex items-center justify-center gap-2 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
            title="Download filtered rankings as CSV"
            aria-live="polite"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exportFlash === "csv" ? "Saved" : "CSV"}
          </button>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => {
              downloadRankingsJson(filtered, position);
              flashExport("json");
            }}
            className="inline-flex items-center justify-center border-l border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
            title="Download filtered rankings as JSON"
            aria-live="polite"
          >
            {exportFlash === "json" ? "Saved" : "JSON"}
          </button>
        </div>
        <button
          type="button"
          onClick={onCopyBoardLink}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
          title="Copy link to this board view (l)"
          aria-keyshortcuts="l"
          aria-live="polite"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          {linkCopied ? "Copied" : linkCopyFailed ? "Failed" : "Link"}
        </button>
        {showDepthToggle && (
          <button
            type="button"
            aria-pressed={hideDepthGoalies}
            onClick={() =>
              startTransition(() => setHideDepthGoalies((v) => !v))
            }
            className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
              hideDepthGoalies
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
            title={`Hide org-depth goalies at 4–${GOALIE_DEPTH_MAX_GP} GP (Shift+G)`}
            aria-keyshortcuts="Shift+G"
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
          aria-keyshortcuts="Shift+Slash"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
