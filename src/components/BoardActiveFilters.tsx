"use client";

import { X } from "lucide-react";
import type { Position } from "@/lib/types";
import {
  boardActiveAllGoaliesChipLabel,
  boardActiveClearPositionAriaLabel,
  boardActiveClearSearchAriaLabel,
  boardActiveEditFiltersTitle,
  boardActiveFiltersRegionLabel,
  boardActiveFiltersVisible,
  boardActivePositionChipLabel,
  boardActiveRemoveStatAriaLabel,
  boardActiveShowStartersAriaLabel,
  boardActiveStatChips,
  showLinkedPlayerAriaLabel,
  showLinkedPlayerChipLabel,
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
  pendingPlayerName?: string | null;
  onRevealPendingPlayer?: () => void;
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
  pendingPlayerName = null,
  onRevealPendingPlayer,
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
      hasLinkedPlayer: Boolean(pendingPlayerName),
    })
  ) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label={boardActiveFiltersRegionLabel()}
    >
      {pendingPlayerName && onRevealPendingPlayer && (
        <button
          type="button"
          onClick={() => {
            onRevealPendingPlayer();
            focusAfterActiveFilterClear();
          }}
          aria-label={showLinkedPlayerAriaLabel(pendingPlayerName)}
          className="inline-flex min-h-11 items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-medium text-cyan-100 transition hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          {showLinkedPlayerChipLabel(pendingPlayerName)}
        </button>
      )}
      {position !== "ALL" && (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2.5 text-xs text-slate-200">
          <span className="py-1 font-medium">
            {boardActivePositionChipLabel(position)}
          </span>
          <button
            type="button"
            aria-label={boardActiveClearPositionAriaLabel()}
            onClick={() => {
              onClearPosition();
              focusAfterActiveFilterClear();
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" aria-hidden="true" />
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
            aria-label={boardActiveClearSearchAriaLabel()}
            onClick={onClearQuery}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      )}
      {showingAllGoalies && (
        <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/5 pl-2.5 text-xs text-slate-200">
          <span className="py-1 font-medium">
            {boardActiveAllGoaliesChipLabel()}
          </span>
          <button
            type="button"
            aria-label={boardActiveShowStartersAriaLabel()}
            onClick={() => {
              onShowStarterGoalies();
              focusAfterActiveFilterClear();
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" aria-hidden="true" />
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
            title={boardActiveEditFiltersTitle()}
          >
            {chip.label} {chip.bounds}
          </button>
          <button
            type="button"
            aria-label={boardActiveRemoveStatAriaLabel(chip.label)}
            onClick={() => {
              onRemoveStat(chip.key);
              focusAfterActiveFilterClear();
            }}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full p-1.5 text-cyan-300/80 transition hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            <X className="h-3 w-3" aria-hidden="true" />
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
          className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          {clearBoardFiltersCopy()}
        </button>
      )}
    </div>
  );
}
