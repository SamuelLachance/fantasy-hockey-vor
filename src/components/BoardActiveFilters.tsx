"use client";

import { X } from "lucide-react";
import type { Position } from "@/lib/types";
import {
  boardActiveFiltersVisible,
  boardActiveStatChips,
} from "@/lib/board-active-filter-chips";
import { clearBoardFiltersCopy } from "@/lib/board-empty-recovery";
import {
  focusAfterActiveFilterClear,
  focusBoardSearch,
} from "@/lib/board-dom";
import type { RangeKey, StatRanges } from "@/lib/rankings-filters";

interface BoardActiveFiltersProps {
  position: Position | "ALL";
  query: string;
  statRanges: StatRanges;
  showStatChips: boolean;
  hasStatFilters: boolean;
  /** True when depth goalies are included (Starters toggle off). */
  showingAllGoalies: boolean;
  onClearPosition: () => void;
  onClearQuery: () => void;
  onOpenStats: () => void;
  onClearStats: () => void;
  onRemoveStat: (key: RangeKey) => void;
  onShowStarterGoalies: () => void;
}

export function BoardActiveFilters({
  position,
  query,
  statRanges,
  showStatChips,
  hasStatFilters,
  showingAllGoalies,
  onClearPosition,
  onClearQuery,
  onOpenStats,
  onClearStats,
  onRemoveStat,
  onShowStarterGoalies,
}: BoardActiveFiltersProps) {
  const q = query.trim();
  const chips = boardActiveStatChips(statRanges, showStatChips);
  if (
    !boardActiveFiltersVisible({
      position,
      query,
      hasStatFilters,
      chipCount: chips.length,
      showingAllGoalies,
    })
  ) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Active board filters"
    >
      {position !== "ALL" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2.5 text-xs text-slate-200">
          <span className="py-1 font-medium">Pos {position}</span>
          <button
            type="button"
            aria-label="Clear position filter"
            onClick={() => {
              onClearPosition();
              focusAfterActiveFilterClear();
            }}
            className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {q !== "" && (
        <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2.5 text-xs text-slate-200">
          <span className="max-w-[12rem] truncate py-1 font-medium" title={q}>
            “{q}”
          </span>
          <button
            type="button"
            aria-label="Clear search"
            onClick={onClearQuery}
            className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {showingAllGoalies && (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2.5 text-xs text-slate-200">
          <span className="py-1 font-medium">All goalies</span>
          <button
            type="button"
            aria-label="Show starter goalies only"
            onClick={() => {
              onShowStarterGoalies();
              focusAfterActiveFilterClear();
            }}
            className="rounded-full p-1 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      )}
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 pl-2.5 text-xs text-cyan-100"
        >
          <button
            type="button"
            onClick={onOpenStats}
            className="py-1 pr-0.5 font-medium tabular-nums transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            title="Edit filters"
          >
            {chip.label} {chip.bounds}
          </button>
          <button
            type="button"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => {
              onRemoveStat(chip.key);
              focusAfterActiveFilterClear();
            }}
            className="rounded-full p-1 text-cyan-300/80 transition hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {(hasStatFilters ||
        position !== "ALL" ||
        q !== "" ||
        showingAllGoalies) && (
        <button
          type="button"
          onClick={() => {
            const preferSearch = q !== "";
            if (position !== "ALL") onClearPosition();
            if (preferSearch) onClearQuery();
            if (hasStatFilters) onClearStats();
            if (showingAllGoalies) onShowStarterGoalies();
            if (preferSearch) queueMicrotask(focusBoardSearch);
            else focusAfterActiveFilterClear();
          }}
          className="rounded-full px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          {clearBoardFiltersCopy()}
        </button>
      )}
    </div>
  );
}
