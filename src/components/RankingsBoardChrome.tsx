"use client";

import { startTransition } from "react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import type { RangeKey, StatRanges } from "@/lib/rankings-filters";
import { focusStatsFilterButton } from "@/lib/board-dom";
import { BoardActiveFilters } from "./BoardActiveFilters";
import { RankingsStatFilters } from "./RankingsStatFilters";
import { RankingsToolbar } from "./RankingsToolbar";

interface RankingsBoardChromeProps {
  position: Position | "ALL";
  setPosition: (pos: Position | "ALL") => void;
  query: string;
  setQuery: (q: string) => void;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  activeFilterCount: number;
  filtered: PlayerProjection[];
  tableCategories: readonly Category[];
  boardLinkStatus: "idle" | "ok" | "err";
  onCopyBoardLink: () => void;
  hideDepthGoalies: boolean;
  setHideDepthGoalies: (v: boolean | ((prev: boolean) => boolean)) => void;
  filterRangeKeys: RangeKey[];
  statRanges: StatRanges;
  onUpdateRange: (key: RangeKey, field: "min" | "max", value: string) => void;
  onClearStatFilters: () => void;
  onRemoveStat: (key: RangeKey) => void;
  showingAllGoalies: boolean;
  onOpenHelp: () => void;
}

/** Sticky toolbar + stat filters + active filter chips above the board. */
export function RankingsBoardChrome({
  position,
  setPosition,
  query,
  setQuery,
  filtersOpen,
  setFiltersOpen,
  activeFilterCount,
  filtered,
  tableCategories,
  boardLinkStatus,
  onCopyBoardLink,
  hideDepthGoalies,
  setHideDepthGoalies,
  filterRangeKeys,
  statRanges,
  onUpdateRange,
  onClearStatFilters,
  onRemoveStat,
  showingAllGoalies,
  onOpenHelp,
}: RankingsBoardChromeProps) {
  return (
    <div
      className="sticky top-0 z-20 -mx-1 space-y-3 bg-slate-950/85 px-1 py-2 backdrop-blur-md motion-reduce:backdrop-blur-none"
      role="region"
      aria-label="Board filters"
    >
      <RankingsToolbar
        position={position}
        setPosition={setPosition}
        query={query}
        setQuery={setQuery}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        activeFilterCount={activeFilterCount}
        filtered={filtered}
        tableCategories={tableCategories}
        linkCopied={boardLinkStatus === "ok"}
        linkCopyFailed={boardLinkStatus === "err"}
        onCopyBoardLink={onCopyBoardLink}
        hideDepthGoalies={hideDepthGoalies}
        setHideDepthGoalies={setHideDepthGoalies}
        showDepthToggle={position === "G" || position === "ALL"}
        onOpenHelp={onOpenHelp}
      />

      {filtersOpen && (
        <RankingsStatFilters
          filterRangeKeys={filterRangeKeys}
          statRanges={statRanges}
          activeFilterCount={activeFilterCount}
          onUpdateRange={onUpdateRange}
          onClear={onClearStatFilters}
          onDone={() => {
            setFiltersOpen(false);
            queueMicrotask(focusStatsFilterButton);
          }}
        />
      )}
      {(activeFilterCount > 0 ||
        position !== "ALL" ||
        query.trim() !== "" ||
        showingAllGoalies) && (
        <BoardActiveFilters
          position={position}
          query={query}
          statRanges={statRanges}
          showStatChips={!filtersOpen && activeFilterCount > 0}
          hasStatFilters={activeFilterCount > 0}
          showingAllGoalies={showingAllGoalies}
          onClearPosition={() => startTransition(() => setPosition("ALL"))}
          onClearQuery={() => setQuery("")}
          onOpenStats={() => setFiltersOpen(true)}
          onClearStats={onClearStatFilters}
          onRemoveStat={onRemoveStat}
          onShowStarterGoalies={() =>
            startTransition(() => setHideDepthGoalies(true))
          }
        />
      )}
    </div>
  );
}
