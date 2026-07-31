"use client";

import {
  boardPositionTabId,
  cycleBoardPosition,
} from "@/lib/board-positions";
import { canOfferAllGoalies } from "@/lib/goalie-depth-toggle";
import { visibleBoardPlayers } from "@/lib/board-visible";
import { startTransition, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import type { PlayerProjection } from "@/lib/types";
import { parseRankingsUrl } from "@/lib/rankings-url";
import { useBoardCopyLinks } from "@/hooks/useBoardCopyLinks";
import { usePlayerDetails } from "@/hooks/usePlayerDetails";
import { useBoardDocumentTitle } from "@/hooks/useBoardDocumentTitle";
import { useBoardInfiniteScroll } from "@/hooks/useBoardInfiniteScroll";
import { useExpandedRowScroll } from "@/hooks/useExpandedRowScroll";
import { useHorizontalScrollShadow } from "@/hooks/useHorizontalScrollShadow";
import { useRankingsBoardState } from "@/hooks/useRankingsBoardState";
import { useRankingsHashJump } from "@/hooks/useRankingsHashJump";
import { useRankingsKeyboard } from "@/hooks/useRankingsKeyboard";
import { useRankingsUrlSync } from "@/hooks/useRankingsUrlSync";
import { RankingsBoardChrome } from "./RankingsBoardChrome";
import { RankingsBoardTable } from "./RankingsBoardTable";
import { RankingsStatusBar } from "./RankingsStatusBar";

const BoardShortcutsHelp = dynamic(
  () =>
    import("./BoardShortcutsHelp").then((m) => m.BoardShortcutsHelp),
  { ssr: false },
);

interface RankingsTableInnerProps {
  players: PlayerProjection[];
}

/** Board body: state, keyboard, table, footer (wrapped by Suspense in RankingsTable). */
export function RankingsTableInner({ players }: RankingsTableInnerProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [seed] = useState(() => parseRankingsUrl(searchParams));
  const board = useRankingsBoardState(players, seed);
  const { boardLinkStatus, playerLinkStatus, copyBoardLink, copyPlayerLink } =
    useBoardCopyLinks(pathname, board.boardShareState, board.expandedId);
  const { details, detailsError, setDetails, setDetailsError } =
    usePlayerDetails(board.expandedId);

  useRankingsUrlSync({
    position: board.position,
    deferredQuery: board.deferredQuery,
    sortKey: board.sortKey,
    sortDir: board.sortDir,
    expandedId: board.expandedId,
    hideDepthGoalies: board.hideDepthGoalies,
    statRanges: board.statRanges,
  });

  useRankingsHashJump();

  const expandedPlayer = board.expandedId
    ? board.filtered.find((p) => p.id === board.expandedId)
    : undefined;

  useBoardDocumentTitle({
    position: board.position,
    query: board.deferredQuery,
    playerName: expandedPlayer?.name ?? null,
  });

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  useHorizontalScrollShadow(tableScrollRef);

  const { loadMoreRef, renderCount, loadMore, canLoadMore } =
    useBoardInfiniteScroll(
      board.filtered,
      board.expandedId,
      board.filterKey,
    );

  useExpandedRowScroll(board.expandedId, renderCount);

  useRankingsKeyboard({
    filtered: board.filtered,
    expandedId: board.expandedId,
    setExpandedId: board.setExpandedId,
    filtersOpen: board.filtersOpen,
    setFiltersOpen: board.setFiltersOpen,
    helpOpen: board.helpOpen,
    setHelpOpen: board.setHelpOpen,
    setSortKey: (key) => startTransition(() => board.setSortKey(key)),
    setSortDir: (dir) => startTransition(() => board.setSortDir(dir)),
    onResetBoard: board.resetBoardView,
    onCopyBoardLink: copyBoardLink,
    onCopyPlayerLink: copyPlayerLink,
    onToggleDepthGoalies: board.toggleDepthGoalies,
    onLoadMore: () => {
      if (canLoadMore) loadMore();
    },
    onClearSearch: () => board.setQuery(""),
    onCyclePosition: (direction) => {
      const pos = cycleBoardPosition(board.position, direction);
      startTransition(() => board.setPosition(pos));
      queueMicrotask(() => {
        document.getElementById(boardPositionTabId(pos))?.focus();
      });
    },
  });

  return (
    <div id="rankings" className="space-y-4 scroll-mt-6">
      <BoardShortcutsHelp
        open={board.helpOpen}
        onClose={() => board.setHelpOpen(false)}
      />
      <RankingsBoardChrome
        position={board.position}
        setPosition={board.setPosition}
        query={board.query}
        setQuery={board.setQuery}
        filtersOpen={board.filtersOpen}
        setFiltersOpen={board.setFiltersOpen}
        activeFilterCount={board.activeFilterCount}
        filtered={board.filtered}
        tableCategories={board.tableCategories}
        boardLinkStatus={boardLinkStatus}
        onCopyBoardLink={copyBoardLink}
        hideDepthGoalies={board.hideDepthGoalies}
        setHideDepthGoalies={board.setHideDepthGoalies}
        filterRangeKeys={board.filterRangeKeys}
        statRanges={board.statRanges}
        onUpdateRange={board.updateRange}
        onClearStatFilters={board.clearStatFilters}
        onRemoveStat={board.removeStatFilter}
        showingAllGoalies={board.showingAllGoalies}
        onOpenHelp={() => board.setHelpOpen(true)}
      />

      <RankingsBoardTable
        tableScrollRef={tableScrollRef}
        sortKey={board.sortKey}
        sortDir={board.sortDir}
        tableCategories={board.tableCategories}
        onToggleSort={board.toggleSort}
        onResetSort={board.resetSortToVor}
        visiblePlayers={visibleBoardPlayers(board.filtered, renderCount)}
        position={board.position}
        deferredQuery={board.deferredQuery}
        expandedId={board.expandedId}
        details={details}
        detailsError={detailsError}
        playerLinkStatus={playerLinkStatus}
        onTogglePlayer={(playerId) =>
          board.setExpandedId((cur) => (cur === playerId ? null : playerId))
        }
        onCopyPlayerLink={copyPlayerLink}
        onDetailsLoaded={(d) => {
          setDetailsError(false);
          setDetails(d);
        }}
        onDetailsError={() => setDetailsError(true)}
        onClearDetailsError={() => setDetailsError(false)}
        query={board.query}
        activeFilterCount={board.activeFilterCount}
        filteredCount={board.filtered.length}
        renderCount={renderCount}
        canLoadMore={canLoadMore}
        loadMoreRef={loadMoreRef}
        onLoadMore={loadMore}
        onClearSearch={() => board.setQuery("")}
        onClearStatFilters={board.clearStatFilters}
        onShowAllPositions={() =>
          startTransition(() => board.setPosition("ALL"))
        }
        canShowAllGoalies={canOfferAllGoalies(
          board.hideDepthGoalies,
          board.position,
        )}
        onShowAllGoalies={() =>
          startTransition(() => board.setHideDepthGoalies(false))
        }
        onResetBoard={board.resetBoardView}
      />
      <RankingsStatusBar
        renderCount={renderCount}
        filteredCount={board.filtered.length}
        totalCount={players.length}
      />
    </div>
  );
}
