"use client";

import type { Category, PlayerProjection, Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import { PositionFilterTabs } from "./PositionFilterTabs";
import { RankingsBoardLinkButton } from "./RankingsBoardLinkButton";
import { RankingsExportButtons } from "./RankingsExportButtons";
import { RankingsGoalieDepthToggle } from "./RankingsGoalieDepthToggle";
import { RankingsHelpButton } from "./RankingsHelpButton";
import { RankingsSearchField } from "./RankingsSearchField";
import { RankingsStatsFilterButton } from "./RankingsStatsFilterButton";

interface RankingsToolbarProps {
  position: Position | "ALL";
  setPosition: (pos: Position | "ALL") => void;
  query: string;
  setQuery: (q: string) => void;
  /** Settled query used for filtering/export provenance. */
  deferredQuery: string;
  filtersOpen: boolean;
  setFiltersOpen: (open: boolean | ((o: boolean) => boolean)) => void;
  activeFilterCount: number;
  filtered: PlayerProjection[];
  tableCategories: readonly Category[];
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  statRanges: StatRanges;
  linkCopied: boolean;
  linkCopyFailed?: boolean;
  onCopyBoardLink: () => void;
  hideDepthGoalies: boolean;
  setHideDepthGoalies: (v: boolean | ((prev: boolean) => boolean)) => void;
  showDepthToggle: boolean;
  helpOpen: boolean;
  onOpenHelp: () => void;
}

export function RankingsToolbar({
  position,
  setPosition,
  query,
  setQuery,
  deferredQuery,
  filtersOpen,
  setFiltersOpen,
  activeFilterCount,
  filtered,
  tableCategories,
  sortKey,
  sortDir,
  statRanges,
  linkCopied,
  linkCopyFailed = false,
  onCopyBoardLink,
  hideDepthGoalies,
  setHideDepthGoalies,
  showDepthToggle,
  helpOpen,
  onOpenHelp,
}: RankingsToolbarProps) {
  const searchPending = query !== deferredQuery;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <PositionFilterTabs position={position} setPosition={setPosition} />
      <div className="flex w-full flex-col gap-2 sm:max-w-3xl sm:flex-row sm:flex-wrap lg:max-w-none">
        <RankingsSearchField query={query} setQuery={setQuery} />
        <RankingsStatsFilterButton
          filtersOpen={filtersOpen}
          activeFilterCount={activeFilterCount}
          setFiltersOpen={setFiltersOpen}
        />
        <RankingsExportButtons
          filtered={filtered}
          position={position}
          tableCategories={tableCategories}
          query={deferredQuery}
          searchPending={searchPending}
          sortKey={sortKey}
          sortDir={sortDir}
          hideDepthGoalies={hideDepthGoalies}
          statRanges={statRanges}
        />
        <RankingsBoardLinkButton
          linkCopied={linkCopied}
          linkCopyFailed={linkCopyFailed}
          onCopyBoardLink={onCopyBoardLink}
        />
        {showDepthToggle && (
          <RankingsGoalieDepthToggle
            hideDepthGoalies={hideDepthGoalies}
            setHideDepthGoalies={setHideDepthGoalies}
          />
        )}
        <RankingsHelpButton helpOpen={helpOpen} onOpenHelp={onOpenHelp} />
      </div>
    </div>
  );
}
