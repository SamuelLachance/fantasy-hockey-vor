"use client";

import { Filter } from "lucide-react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import { PositionFilterTabs } from "./PositionFilterTabs";
import { RankingsBoardLinkButton } from "./RankingsBoardLinkButton";
import { RankingsExportButtons } from "./RankingsExportButtons";
import { RankingsGoalieDepthToggle } from "./RankingsGoalieDepthToggle";
import { RankingsHelpButton } from "./RankingsHelpButton";
import { RankingsSearchField } from "./RankingsSearchField";

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
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <PositionFilterTabs position={position} setPosition={setPosition} />
      <div className="flex w-full flex-col gap-2 sm:max-w-3xl sm:flex-row sm:flex-wrap lg:max-w-none">
        <RankingsSearchField query={query} setQuery={setQuery} />
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
            <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-xs font-bold tabular-nums text-slate-950">
              {activeFilterCount}
            </span>
          )}
        </button>
        <RankingsExportButtons
          filtered={filtered}
          position={position}
          tableCategories={tableCategories}
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
        <RankingsHelpButton onOpenHelp={onOpenHelp} />
      </div>
    </div>
  );
}
