"use client";

import { cycleBoardPosition } from "@/lib/board-positions";
import { canOfferAllGoalies } from "@/lib/goalie-depth-toggle";
import { focusBoardSearch } from "@/lib/board-dom";
import { visibleBoardPlayers } from "@/lib/board-visible";
import { boardLinkedPlayerView } from "@/lib/board-players";
import { searchQueryIsClearable } from "@/lib/highlight-match";
import { startTransition, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { PlayerProjection } from "@/lib/types";
import { parseRankingsUrl } from "@/lib/rankings-url";
import { useBoardCopyLinks } from "@/hooks/useBoardCopyLinks";
import { usePlayerDetails } from "@/hooks/usePlayerDetails";
import { useBoardDocumentTitle } from "@/hooks/useBoardDocumentTitle";
import { useBoardInfiniteScroll } from "@/hooks/useBoardInfiniteScroll";
import { useBoardStickyChromeHeight } from "@/hooks/useBoardStickyChromeHeight";
import { useCoercedExpandFocusRestore } from "@/hooks/useCoercedExpandFocusRestore";
import { useExpandedRowScroll } from "@/hooks/useExpandedRowScroll";
import { useHorizontalScrollShadow } from "@/hooks/useHorizontalScrollShadow";
import { useOrphanedBoardRowFocusRestore } from "@/hooks/useOrphanedBoardRowFocusRestore";
import { useRankingsBoardState } from "@/hooks/useRankingsBoardState";
import { useRankingsHashJump } from "@/hooks/useRankingsHashJump";
import { useRankingsKeyboard } from "@/hooks/useRankingsKeyboard";
import { useRankingsUrlSync } from "@/hooks/useRankingsUrlSync";
import { BoardShortcutsHelp } from "./BoardShortcutsHelp";
import { RankingsBoardChrome } from "./RankingsBoardChrome";
import { RankingsBoardTable } from "./RankingsBoardTable";
import { RankingsStatusBar } from "./RankingsStatusBar";

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
    useBoardCopyLinks(pathname, board.boardShareState);
  const linked = boardLinkedPlayerView({
    allPlayers: players,
    filtered: board.filtered,
    expandedId: board.expandedId,
    pendingPlayerId: board.pendingPlayerId,
  });
  const { details, detailsError, setDetails, setDetailsError } =
    usePlayerDetails(linked.urlPlayerId);

  useRankingsUrlSync({
    position: board.position,
    query: board.deferredQuery, // settled filter
    sortKey: board.sortKey,
    sortDir: board.sortDir,
    expandedId: linked.urlPlayerId,
    hideDepthGoalies: board.hideDepthGoalies,
    statRanges: board.statRanges,
    onHydrate: board.hydrateFromUrl,
  });

  useRankingsHashJump(board.filtered, players);

  useBoardDocumentTitle({
    position: board.position,
    query: board.deferredQuery,
    playerName: linked.titlePlayerName,
    sortKey: board.sortKey,
    sortDir: board.sortDir,
    activeFilterCount: board.activeFilterCount,
    showingAllGoalies: board.showingAllGoalies,
  });

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  useHorizontalScrollShadow(tableScrollRef);
  useBoardStickyChromeHeight();

  const { loadMoreRef, renderCount, loadMore, canLoadMore } =
    useBoardInfiniteScroll(
      board.filtered,
      board.expandedId,
      board.filterKey,
    );

  useExpandedRowScroll(board.expandedId, board.sortKey, board.sortDir);
  useCoercedExpandFocusRestore(board.expandedId);
  useOrphanedBoardRowFocusRestore(board.filterKey);

  function clearBoardSearch() {
    board.setQuery("");
    queueMicrotask(focusBoardSearch);
  }

  useRankingsKeyboard({
    filtered: board.filtered,
    renderCount,
    expandedId: board.expandedId,
    pendingPlayerId: board.pendingPlayerId,
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
    hasQuery: searchQueryIsClearable(board.query),
    onClearSearch: clearBoardSearch,
    onCyclePosition: (direction) => {
      const pos = cycleBoardPosition(board.position, direction);
      // Keep focus on the board (not the tab) so chrome hotkey gating does not
      // block j/k/l/p after [ / ]. PositionFilterTabs aria-live announces the change.
      startTransition(() => board.setPosition(pos));
    },
  });

  return (
    <div className="space-y-4">
      <BoardShortcutsHelp
        open={board.helpOpen}
        onClose={() => board.setHelpOpen(false)}
      />
      <RankingsBoardChrome
        position={board.position}
        setPosition={board.setPosition}
        query={board.query}
        setQuery={board.setQuery}
        deferredQuery={board.deferredQuery}
        filtersOpen={board.filtersOpen}
        setFiltersOpen={board.setFiltersOpen}
        activeFilterCount={board.activeFilterCount}
        filtered={board.filtered}
        tableCategories={board.tableCategories}
        sortKey={board.sortKey}
        sortDir={board.sortDir}
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
        helpOpen={board.helpOpen}
        onOpenHelp={() => board.setHelpOpen(true)}
        pendingPlayerName={linked.chipPlayerName}
        onRevealPendingPlayer={board.revealPendingPlayer}
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
        onClearSearch={clearBoardSearch}
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
        pendingPlayerName={linked.emptyPlayerName}
        onRevealPendingPlayer={board.revealPendingPlayer}
      />
      <RankingsStatusBar
        renderCount={renderCount}
        filteredCount={board.filtered.length}
        totalCount={players.length}
        searchPending={board.query !== board.deferredQuery}
        linkedPlayerName={linked.chipPlayerName}
      />
    </div>
  );
}
