"use client";

import { Filter } from "lucide-react";
import { focusFirstStatFilterInput } from "@/lib/board-dom";
import {
  statsFilterButtonLabel,
  statsFilterButtonTitle,
} from "@/lib/stat-filters-copy";

interface RankingsStatsFilterButtonProps {
  filtersOpen: boolean;
  activeFilterCount: number;
  setFiltersOpen: (open: boolean | ((o: boolean) => boolean)) => void;
}

/** Toolbar Stats button that opens/closes the range-filter panel (f opens, Esc closes). */
export function RankingsStatsFilterButton({
  filtersOpen,
  activeFilterCount,
  setFiltersOpen,
}: RankingsStatsFilterButtonProps) {
  return (
    <button
      type="button"
      onClick={() =>
        setFiltersOpen((o) => {
          const next = !o;
          if (next) queueMicrotask(focusFirstStatFilterInput);
          return next;
        })
      }
      aria-keyshortcuts="f"
      aria-expanded={filtersOpen}
      aria-controls={filtersOpen ? "rankings-stat-filters" : undefined}
      title={statsFilterButtonTitle()}
      className={`inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
        filtersOpen || activeFilterCount > 0
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
    >
      <Filter className="h-4 w-4" aria-hidden="true" />
      {statsFilterButtonLabel()}
      {activeFilterCount > 0 && (
        <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-950">
          {activeFilterCount}
        </span>
      )}
    </button>
  );
}
