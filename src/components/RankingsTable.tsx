"use client";

import { Suspense, startTransition, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import type { PlayerProjection } from "@/lib/types";
import { copyTextWithFlash } from "@/lib/copy-flash";
import { parseRankingsUrl, rankingsShareUrl } from "@/lib/rankings-url";
import {
  scrollExpandedRowIntoView,
  scrollToRankings,
} from "@/lib/board-dom";
import { usePlayerDetails } from "@/hooks/usePlayerDetails";
import { useBoardDocumentTitle } from "@/hooks/useBoardDocumentTitle";
import { useBoardInfiniteScroll } from "@/hooks/useBoardInfiniteScroll";
import { useHorizontalScrollShadow } from "@/hooks/useHorizontalScrollShadow";
import { useRankingsBoardState } from "@/hooks/useRankingsBoardState";
import { useRankingsKeyboard } from "@/hooks/useRankingsKeyboard";
import { useRankingsUrlSync } from "@/hooks/useRankingsUrlSync";
import { RankingsBoardChrome } from "./RankingsBoardChrome";
import { RankingsBoardFooter } from "./RankingsBoardFooter";
import { RankingsPlayerRow } from "./RankingsPlayerRow";
import { RankingsStatusBar } from "./RankingsStatusBar";
import { RankingsTableHead } from "./RankingsTableHead";

const BoardShortcutsHelp = dynamic(
  () =>
    import("./BoardShortcutsHelp").then((m) => m.BoardShortcutsHelp),
  { ssr: false },
);

interface RankingsTableProps {
  players: PlayerProjection[];
}

function RankingsTableInner({ players }: RankingsTableProps) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const [seed] = useState(() => parseRankingsUrl(searchParams));
  const board = useRankingsBoardState(players, seed);
  const [boardLinkStatus, setBoardLinkStatus] = useState<
    "idle" | "ok" | "err"
  >("idle");
  const [playerLinkStatus, setPlayerLinkStatus] = useState<{
    id: number | null;
    status: "idle" | "ok" | "err";
  }>({ id: null, status: "idle" });
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

  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      scrollToRankings({ focusSearch: true });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);

  const expandedPlayer = board.expandedId
    ? board.filtered.find((p) => p.id === board.expandedId)
    : undefined;

  useBoardDocumentTitle({
    position: board.position,
    query: board.deferredQuery,
    playerName: expandedPlayer?.name ?? null,
  });

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const showStickyShadow = useHorizontalScrollShadow(tableScrollRef);

  const { loadMoreRef, renderCount, loadMore, canLoadMore } =
    useBoardInfiniteScroll(
      board.filtered,
      board.expandedId,
      board.filterKey,
    );

  useEffect(() => {
    if (board.expandedId == null) return;
    scrollExpandedRowIntoView(board.expandedId);
  }, [board.expandedId, renderCount]);

  function copyBoardLink() {
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        board.boardShareState(board.expandedId),
      ),
      setBoardLinkStatus,
    );
  }

  function copyPlayerLink(playerId: number) {
    setPlayerLinkStatus({ id: playerId, status: "idle" });
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        board.boardShareState(playerId),
      ),
      (status) => {
        setPlayerLinkStatus({ id: playerId, status });
      },
    );
  }

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
    onToggleDepthGoalies: board.toggleDepthGoalies,
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

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table
            id="rankings-board-table"
            aria-label="Fantasy hockey VOR rankings"
            className="min-w-full text-left text-sm"
          >
            <RankingsTableHead
              sortKey={board.sortKey}
              sortDir={board.sortDir}
              tableCategories={board.tableCategories}
              showStickyShadow={showStickyShadow}
              onToggleSort={board.toggleSort}
              onResetSort={board.resetSortToVor}
            />
            <tbody className="divide-y divide-white/5">
              {board.filtered.slice(0, renderCount).map((player, idx) => (
                <RankingsPlayerRow
                  key={player.id}
                  player={player}
                  idx={idx}
                  position={board.position}
                  deferredQuery={board.deferredQuery}
                  isExpanded={board.expandedId === player.id}
                  showStickyShadow={showStickyShadow}
                  tableCategories={board.tableCategories}
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
                  onToggle={() =>
                    board.setExpandedId((cur) =>
                      cur === player.id ? null : player.id,
                    )
                  }
                  onCopyLink={() => copyPlayerLink(player.id)}
                  onDetailsLoaded={(d) => {
                    setDetailsError(false);
                    setDetails(d);
                  }}
                  onDetailsError={() => setDetailsError(true)}
                  onClearDetailsError={() => setDetailsError(false)}
                />
              ))}
            </tbody>
          </table>
        </div>
        <RankingsBoardFooter
          query={board.query}
          activeFilterCount={board.activeFilterCount}
          position={board.position}
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
          canShowAllGoalies={
            board.hideDepthGoalies &&
            (board.position === "G" || board.position === "ALL")
          }
          onShowAllGoalies={() =>
            startTransition(() => board.setHideDepthGoalies(false))
          }
          onResetBoard={board.resetBoardView}
        />
      </div>
      <RankingsStatusBar
        renderCount={renderCount}
        filteredCount={board.filtered.length}
        totalCount={players.length}
      />
    </div>
  );
}

export function RankingsTable({ players }: RankingsTableProps) {
  return (
    <Suspense
      fallback={
        <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-6 py-16 text-center text-slate-400">
          Loading rankings…
        </div>
      }
    >
      <RankingsTableInner players={players} />
    </Suspense>
  );
}
