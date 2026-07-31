"use client";

import { boardRowTabStopId } from "@/lib/board-visible";
import { useState, type RefObject } from "react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import type { SortKey } from "@/lib/rankings-filters";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import { RankingsBoardFooter } from "./RankingsBoardFooter";
import { RankingsPlayerRow } from "./RankingsPlayerRow";
import { RankingsTableHead } from "./RankingsTableHead";

interface RankingsBoardTableProps {
  tableScrollRef: RefObject<HTMLDivElement | null>;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  tableCategories: readonly Category[];
  onToggleSort: (key: SortKey) => void;
  onResetSort: () => void;
  visiblePlayers: PlayerProjection[];
  position: Position | "ALL";
  deferredQuery: string;
  expandedId: number | null;
  details: Record<string, PlayerDetailRecord> | null;
  detailsError: boolean;
  playerLinkStatus: { id: number | null; status: "idle" | "ok" | "err" };
  onTogglePlayer: (playerId: number) => void;
  onCopyPlayerLink: (playerId: number) => void;
  onDetailsLoaded: (d: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
  query: string;
  activeFilterCount: number;
  filteredCount: number;
  renderCount: number;
  canLoadMore: boolean;
  loadMoreRef: RefObject<HTMLDivElement | null>;
  onLoadMore: () => void;
  onClearSearch: () => void;
  onClearStatFilters: () => void;
  onShowAllPositions: () => void;
  canShowAllGoalies: boolean;
  onShowAllGoalies: () => void;
  onResetBoard: () => void;
}

/** Scrollable rankings table body + footer (empty / load-more). */
export function RankingsBoardTable({
  tableScrollRef,
  sortKey,
  sortDir,
  tableCategories,
  onToggleSort,
  onResetSort,
  visiblePlayers,
  position,
  deferredQuery,
  expandedId,
  details,
  detailsError,
  playerLinkStatus,
  onTogglePlayer,
  onCopyPlayerLink,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
  query,
  activeFilterCount,
  filteredCount,
  renderCount,
  canLoadMore,
  loadMoreRef,
  onLoadMore,
  onClearSearch,
  onClearStatFilters,
  onShowAllPositions,
  canShowAllGoalies,
  onShowAllGoalies,
  onResetBoard,
}: RankingsBoardTableProps) {
  const [anchorId, setAnchorId] = useState<number | null>(expandedId);
  if (expandedId != null && expandedId !== anchorId) {
    setAnchorId(expandedId);
  }
  const tabStopId = boardRowTabStopId(visiblePlayers, expandedId, anchorId);
  const searchPending = query !== deferredQuery;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
      <div
        ref={tableScrollRef}
        className="group/hscroll overflow-x-auto overscroll-x-contain"
      >
        <table
          id="rankings-board-table"
          aria-label="Fantasy hockey VOR rankings"
          aria-busy={searchPending || undefined}
          aria-rowcount={filteredCount > 0 ? filteredCount : undefined}
          className="min-w-full text-left text-sm"
        >
          <RankingsTableHead
            sortKey={sortKey}
            sortDir={sortDir}
            tableCategories={tableCategories}
            onToggleSort={onToggleSort}
            onResetSort={onResetSort}
          />
          <tbody className="divide-y divide-white/5">
            {visiblePlayers.map((player, idx) => (
              <RankingsPlayerRow
                key={player.id}
                player={player}
                idx={idx}
                position={position}
                deferredQuery={deferredQuery}
                isExpanded={expandedId === player.id}
                isTabStop={player.id === tabStopId}
                tableCategories={tableCategories}
                playerDetails={details?.[String(player.id)]}
                detailsLoading={details === null && !detailsError}
                detailsError={detailsError && details === null}
                linkCopied={
                  playerLinkStatus.id === player.id &&
                  playerLinkStatus.status === "ok"
                }
                linkCopyFailed={
                  playerLinkStatus.id === player.id &&
                  playerLinkStatus.status === "err"
                }
                onToggle={() => onTogglePlayer(player.id)}
                onCopyLink={() => onCopyPlayerLink(player.id)}
                onDetailsLoaded={onDetailsLoaded}
                onDetailsError={onDetailsError}
                onClearDetailsError={onClearDetailsError}
              />
            ))}
          </tbody>
        </table>
      </div>
      <RankingsBoardFooter
        query={query}
        activeFilterCount={activeFilterCount}
        position={position}
        filteredCount={filteredCount}
        renderCount={renderCount}
        canLoadMore={canLoadMore}
        loadMoreRef={loadMoreRef}
        onLoadMore={onLoadMore}
        onClearSearch={onClearSearch}
        onClearStatFilters={onClearStatFilters}
        onShowAllPositions={onShowAllPositions}
        canShowAllGoalies={canShowAllGoalies}
        onShowAllGoalies={onShowAllGoalies}
        onResetBoard={onResetBoard}
      />
    </div>
  );
}
