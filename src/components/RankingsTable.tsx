"use client";

import {
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import dynamic from "next/dynamic";
import { usePathname, useSearchParams } from "next/navigation";
import type { PlayerProjection, Position } from "@/lib/types";
import {
  defaultSortDir,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import {
  boardCategories,
  boardFilterKeys,
  coerceSortKeyForPosition,
  filterAndSortBoard,
} from "@/lib/rankings-board";
import { countActiveStatFilters } from "@/lib/board-active-filters";
import { boardHasPlayerId } from "@/lib/board-players";
import { boardFilterResetToken } from "@/lib/board-reset-token";
import { copyTextWithFlash } from "@/lib/copy-flash";
import { parseRankingsUrl, rankingsShareUrl } from "@/lib/rankings-url";
import {
  scrollExpandedRowIntoView,
  scrollToRankings,
} from "@/lib/board-dom";
import { usePlayerDetails } from "@/hooks/usePlayerDetails";
import { useBoardInfiniteScroll } from "@/hooks/useBoardInfiniteScroll";
import { useHorizontalScrollShadow } from "@/hooks/useHorizontalScrollShadow";
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
  const [query, setQuery] = useState(seed.query);
  const deferredQuery = useDeferredValue(query);
  const [position, setPosition] = useState<Position | "ALL">(seed.position);
  const [sortKey, setSortKey] = useState<SortKey>(seed.sortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(seed.sortDir);
  const [statRanges, setStatRanges] = useState<StatRanges>(seed.statRanges);
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      Object.values(seed.statRanges).some(
        (b) => b?.min?.trim() || b?.max?.trim(),
      ),
  );
  const [boardLinkStatus, setBoardLinkStatus] = useState<
    "idle" | "ok" | "err"
  >("idle");
  const [hideDepthGoalies, setHideDepthGoalies] = useState(
    seed.hideDepthGoalies,
  );
  const [expandedId, setExpandedId] = useState<number | null>(seed.playerId);
  const [playerLinkStatus, setPlayerLinkStatus] = useState<{
    id: number | null;
    status: "idle" | "ok" | "err";
  }>({ id: null, status: "idle" });
  const [helpOpen, setHelpOpen] = useState(false);
  const { details, detailsError, setDetails, setDetailsError } =
    usePlayerDetails(expandedId);

  useRankingsUrlSync({
    position,
    deferredQuery,
    sortKey,
    sortDir,
    expandedId,
    hideDepthGoalies,
    statRanges,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#rankings") return;
    scrollToRankings({ focusSearch: true });
  }, []);

  // Drop deep-linked expand ids that are no longer on the board dataset.
  if (expandedId != null && !boardHasPlayerId(players, expandedId)) {
    setExpandedId(null);
  }

  const filterRangeKeys = useMemo(
    () => boardFilterKeys(position),
    [position],
  );

  const activeFilterCount = useMemo(
    () => countActiveStatFilters(statRanges, filterRangeKeys),
    [statRanges, filterRangeKeys],
  );

  const filterKey = boardFilterResetToken(
    position,
    deferredQuery,
    statRanges,
    hideDepthGoalies,
  );
  const [prevPosition, setPrevPosition] = useState(position);
  if (position !== prevPosition) {
    setPrevPosition(position);
    // Drop sorts on categories that disappear under the new filter (e.g. FOW on D).
    const nextKey = coerceSortKeyForPosition(sortKey, position);
    if (nextKey !== sortKey) {
      setSortKey(nextKey);
      setSortDir("desc");
    }
  }

  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const showStickyShadow = useHorizontalScrollShadow(tableScrollRef);

  const filtered = useMemo(
    () =>
      filterAndSortBoard(players, {
        position,
        query: deferredQuery,
        sortKey,
        sortDir,
        statRanges,
        hideDepthGoalies,
      }),
    [
      players,
      deferredQuery,
      position,
      sortKey,
      sortDir,
      statRanges,
      hideDepthGoalies,
    ],
  );

  const { loadMoreRef, renderCount, loadMore, canLoadMore } =
    useBoardInfiniteScroll(filtered, expandedId, filterKey);

  useEffect(() => {
    if (expandedId == null) return;
    scrollExpandedRowIntoView(expandedId);
  }, [expandedId, renderCount]);

  function clearStatFilters() {
    startTransition(() => setStatRanges({}));
  }

  function removeStatFilter(key: RangeKey) {
    startTransition(() => {
      setStatRanges((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });
  }

  function resetBoardView() {
    setQuery("");
    clearStatFilters();
    setFiltersOpen(false);
    setExpandedId(null);
    startTransition(() => {
      setPosition("ALL");
      setHideDepthGoalies(true);
      setSortKey("vor");
      setSortDir("desc");
    });
  }

  function boardShareState(playerId: number | null) {
    return {
      position,
      query: deferredQuery,
      sortKey,
      sortDir,
      playerId,
      hideDepthGoalies,
      statRanges,
    };
  }

  function copyBoardLink() {
    copyTextWithFlash(
      rankingsShareUrl(
        window.location.origin,
        pathname,
        boardShareState(expandedId),
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
        boardShareState(playerId),
      ),
      (status) => {
        setPlayerLinkStatus({ id: playerId, status });
      },
    );
  }

  useRankingsKeyboard({
    filtered,
    expandedId,
    setExpandedId,
    filtersOpen,
    setFiltersOpen,
    helpOpen,
    setHelpOpen,
    setSortKey: (key) => startTransition(() => setSortKey(key)),
    setSortDir: (dir) => startTransition(() => setSortDir(dir)),
    onResetBoard: resetBoardView,
    onCopyBoardLink: copyBoardLink,
  });

  function toggleSort(key: SortKey) {
    startTransition(() => {
      if (sortKey === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDir(defaultSortDir(key));
      }
    });
  }

  function resetSortToVor() {
    startTransition(() => {
      setSortKey("vor");
      setSortDir("desc");
    });
  }

  function updateRange(key: RangeKey, field: "min" | "max", value: string) {
    startTransition(() => {
      setStatRanges((prev) => ({
        ...prev,
        [key]: { min: "", max: "", ...prev[key], [field]: value },
      }));
    });
  }

  const tableCategories = boardCategories(position);
  const showingAllGoalies =
    !hideDepthGoalies && (position === "G" || position === "ALL");

  return (
    <div id="rankings" className="space-y-4 scroll-mt-6">
      <BoardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <RankingsBoardChrome
        position={position}
        setPosition={setPosition}
        query={query}
        setQuery={setQuery}
        filtersOpen={filtersOpen}
        setFiltersOpen={setFiltersOpen}
        activeFilterCount={activeFilterCount}
        filtered={filtered}
        tableCategories={tableCategories}
        boardLinkStatus={boardLinkStatus}
        onCopyBoardLink={copyBoardLink}
        hideDepthGoalies={hideDepthGoalies}
        setHideDepthGoalies={setHideDepthGoalies}
        filterRangeKeys={filterRangeKeys}
        statRanges={statRanges}
        onUpdateRange={updateRange}
        onClearStatFilters={clearStatFilters}
        onRemoveStat={removeStatFilter}
        showingAllGoalies={showingAllGoalies}
        onOpenHelp={() => setHelpOpen(true)}
      />

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
        <div ref={tableScrollRef} className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <RankingsTableHead
              sortKey={sortKey}
              sortDir={sortDir}
              tableCategories={tableCategories}
              showStickyShadow={showStickyShadow}
              onToggleSort={toggleSort}
              onResetSort={resetSortToVor}
            />
            <tbody className="divide-y divide-white/5">
              {filtered.slice(0, renderCount).map((player, idx) => (
                <RankingsPlayerRow
                  key={player.id}
                  player={player}
                  idx={idx}
                  position={position}
                  deferredQuery={deferredQuery}
                  isExpanded={expandedId === player.id}
                  showStickyShadow={showStickyShadow}
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
                  onToggle={() =>
                    setExpandedId((cur) =>
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
          query={query}
          activeFilterCount={activeFilterCount}
          position={position}
          filteredCount={filtered.length}
          canLoadMore={canLoadMore}
          loadMoreRef={loadMoreRef}
          onLoadMore={loadMore}
          onClearSearch={() => setQuery("")}
          onClearStatFilters={clearStatFilters}
          onShowAllPositions={() =>
            startTransition(() => setPosition("ALL"))
          }
          onResetBoard={resetBoardView}
        />
      </div>
      <RankingsStatusBar
        renderCount={renderCount}
        filteredCount={filtered.length}
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
