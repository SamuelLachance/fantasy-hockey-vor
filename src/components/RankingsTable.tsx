"use client";

import {
  Fragment,
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
  CATEGORY_LABELS,
  edgeColor,
  formatCount,
  formatStat,
  playerCategories,
  sigmaColor,
  vorColor,
} from "@/lib/format";
import {
  defaultSortDir,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import {
  boardCategories,
  boardFilterKeys,
  filterAndSortBoard,
} from "@/lib/rankings-board";
import { copyText } from "@/lib/clipboard";
import { highlightMatch } from "@/lib/highlight-match";
import { parseRankingsUrl, rankingsShareUrl } from "@/lib/rankings-url";
import { usePlayerDetails } from "@/hooks/usePlayerDetails";
import { useRankingsKeyboard } from "@/hooks/useRankingsKeyboard";
import { useRankingsUrlSync } from "@/hooks/useRankingsUrlSync";
import { ActiveStatFilterChips } from "./ActiveStatFilterChips";
import { PositionBadges } from "./PositionBadge";
import { RankingsEmptyState } from "./RankingsEmptyState";
import { RankingsStatFilters } from "./RankingsStatFilters";
import { RankingsToolbar } from "./RankingsToolbar";
import { SortHeader } from "./SortHeader";

const BoardShortcutsHelp = dynamic(
  () =>
    import("./BoardShortcutsHelp").then((m) => m.BoardShortcutsHelp),
  { ssr: false },
);
const ExpandedPlayerPanel = dynamic(
  () =>
    import("./ExpandedPlayerPanel").then((m) => m.ExpandedPlayerPanel),
  { ssr: false },
);

interface RankingsTableProps {
  players: PlayerProjection[];
}

/** Initial paint budget — infinite scroll grows by this step. */
const PAGE_SIZE = 60;

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
  const [linkCopied, setLinkCopied] = useState(false);
  const [hideDepthGoalies, setHideDepthGoalies] = useState(
    seed.hideDepthGoalies,
  );
  const [expandedId, setExpandedId] = useState<number | null>(seed.playerId);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [copiedPlayerId, setCopiedPlayerId] = useState<number | null>(null);
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
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById("rankings")?.scrollIntoView({
      block: "start",
      behavior: reduce ? "auto" : "smooth",
    });
  }, []);

  const filterRangeKeys = useMemo(
    () => boardFilterKeys(position),
    [position],
  );

  const activeFilterCount = useMemo(() => {
    let n = 0;
    for (const key of filterRangeKeys) {
      const b = statRanges[key];
      if (b?.min?.trim() || b?.max?.trim()) n++;
    }
    return n;
  }, [statRanges, filterRangeKeys]);

  const filterKey = `${position}|${deferredQuery.trim().toLowerCase()}|${JSON.stringify(statRanges)}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  const [prevPosition, setPrevPosition] = useState(position);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }
  if (position !== prevPosition) {
    setPrevPosition(position);
    // Drop sorts on categories that disappear under the new filter (e.g. FOW on D).
    const cats = boardCategories(position);
    if (
      sortKey !== "rank" &&
      sortKey !== "vor" &&
      sortKey !== "name" &&
      sortKey !== "team" &&
      sortKey !== "gamesPlayed" &&
      sortKey !== "draftValue" &&
      sortKey !== "sigma" &&
      !(cats as readonly string[]).includes(sortKey)
    ) {
      setSortKey("vor");
      setSortDir("desc");
    }
  }

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

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

  const renderCount = useMemo(() => {
    if (expandedId == null) return visibleCount;
    const idx = filtered.findIndex((p) => p.id === expandedId);
    if (idx < 0) return visibleCount;
    return Math.max(
      visibleCount,
      Math.min(filtered.length, idx + 1 + PAGE_SIZE),
    );
  }, [expandedId, filtered, visibleCount]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || filtered.length <= renderCount) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          startTransition(() => {
            setVisibleCount((c) => Math.min(c + PAGE_SIZE, filtered.length));
          });
        }
      },
      { rootMargin: "240px 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [filtered.length, renderCount]);

  useEffect(() => {
    if (expandedId == null) return;
    const row = document.getElementById(`player-row-${expandedId}`);
    if (!row) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    row.scrollIntoView({
      block: "nearest",
      behavior: reduce ? "auto" : "smooth",
    });
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

  return (
    <div id="rankings" className="space-y-4 scroll-mt-6">
      <BoardShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <div className="sticky top-0 z-20 -mx-1 space-y-3 bg-slate-950/85 px-1 py-2 backdrop-blur-md">
        <RankingsToolbar
          position={position}
          setPosition={setPosition}
          query={query}
          setQuery={setQuery}
          deferredQuery={deferredQuery}
          sortKey={sortKey}
          sortDir={sortDir}
          pathname={pathname}
          filtersOpen={filtersOpen}
          setFiltersOpen={setFiltersOpen}
          activeFilterCount={activeFilterCount}
          filtered={filtered}
          tableCategories={tableCategories}
          linkCopied={linkCopied}
          onLinkCopied={() => {
            setLinkCopied(true);
            window.setTimeout(() => setLinkCopied(false), 1600);
          }}
          expandedId={expandedId}
          hideDepthGoalies={hideDepthGoalies}
          setHideDepthGoalies={setHideDepthGoalies}
          showDepthToggle={position === "G" || position === "ALL"}
          onOpenHelp={() => setHelpOpen(true)}
          statRanges={statRanges}
        />

        {filtersOpen && (
          <RankingsStatFilters
            filterRangeKeys={filterRangeKeys}
            statRanges={statRanges}
            activeFilterCount={activeFilterCount}
            onUpdateRange={updateRange}
            onClear={clearStatFilters}
            onDone={() => setFiltersOpen(false)}
          />
        )}
        {!filtersOpen && activeFilterCount > 0 && (
          <ActiveStatFilterChips
            statRanges={statRanges}
            onOpen={() => setFiltersOpen(true)}
            onClear={clearStatFilters}
            onRemove={removeStatFilter}
          />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-wider text-slate-400 backdrop-blur-sm">
              <tr>
                <SortHeader
                  column="rank"
                  label="#"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="sticky left-0 z-[5] bg-slate-950/95 px-4 py-3"
                />
                <SortHeader
                  column="name"
                  label="Player"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="sticky left-10 z-[5] bg-slate-950/95 px-4 py-3 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.5)] sm:left-12"
                />
                <th className="px-4 py-3">Pos</th>
                <SortHeader
                  column="team"
                  label="Team"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="px-4 py-3"
                />
                <SortHeader
                  column="vor"
                  label="VOR"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="px-4 py-3"
                />
                <SortHeader
                  column="draftValue"
                  label="Edge"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="px-4 py-3"
                  title="Consensus rank − model rank. Positive = undervalued vs synthetic market (Marcel/EWMA/lag1)."
                />
                <SortHeader
                  column="sigma"
                  label="Σσ"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="px-3 py-3"
                  title="Calibrated aggregate uncertainty (1σ). Lower is more confident. Default sort ascending."
                />
                <SortHeader
                  column="gamesPlayed"
                  label="GP"
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggle={toggleSort}
                  onReset={resetSortToVor}
                  className="px-4 py-3"
                />
                {tableCategories.map((cat) => (
                  <SortHeader
                    key={cat}
                    column={cat}
                    label={CATEGORY_LABELS[cat]}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onToggle={toggleSort}
                    onReset={resetSortToVor}
                    className="px-3 py-3 text-center"
                    center
                  />
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.slice(0, renderCount).map((player, idx) => {
                const isExpanded = expandedId === player.id;
                const cats = playerCategories(player);
                const playerDetails = details?.[String(player.id)];
                return (
                  <Fragment key={player.id}>
                    <tr
                      id={`player-row-${player.id}`}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : player.id)
                      }
                      className={`cursor-pointer transition hover:bg-cyan-500/5 ${
                        isExpanded ? "bg-cyan-500/10" : ""
                      }`}
                    >
                      <td
                        className={`sticky left-0 z-[1] px-4 py-3 font-mono text-slate-400 ${
                          isExpanded ? "bg-slate-900" : "bg-slate-950/95"
                        }`}
                      >
                        {position === "ALL"
                          ? player.rank
                          : (player.positionRank ?? idx + 1)}
                      </td>
                      <td
                        className={`sticky left-10 z-[1] max-w-[9.5rem] truncate px-4 py-3 font-medium text-white shadow-[4px_0_8px_-4px_rgba(0,0,0,0.5)] sm:left-12 sm:max-w-[14rem] ${
                          isExpanded ? "bg-slate-900" : "bg-slate-950/95"
                        }`}
                        title={player.name}
                      >
                        {highlightMatch(player.name, deferredQuery)}
                      </td>
                      <td className="px-4 py-3">
                        <PositionBadges
                          positions={player.positions}
                          vorPosition={player.vorPosition ?? player.position}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {highlightMatch(player.team, deferredQuery)}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono font-semibold ${vorColor(vorForFilter(player, position))}`}
                      >
                        {vorForFilter(player, position) >= 0 ? "+" : ""}
                        {vorForFilter(player, position).toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono text-sm ${edgeColor(player.draftValue ?? 0)}`}
                        title={
                          player.syntheticMarketRank != null
                            ? `Consensus rank ${player.syntheticMarketRank} − model rank ${player.rank}`
                            : undefined
                        }
                      >
                        {(player.draftValue ?? 0) > 0 ? "+" : ""}
                        {player.draftValue ?? 0}
                      </td>
                      <td
                        className={`px-3 py-3 font-mono text-sm ${
                          player.uncertainty?.total?.sigma != null
                            ? sigmaColor(player.uncertainty.total.sigma)
                            : "text-slate-500"
                        }`}
                        title={
                          player.uncertainty?.total?.sigma != null
                            ? `Σσ ${player.uncertainty.total.sigma.toFixed(1)} (lower = more confident)`
                            : "No calibrated uncertainty"
                        }
                      >
                        {player.uncertainty?.total?.sigma != null
                          ? player.uncertainty.total.sigma.toFixed(0)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400">
                        {player.gamesPlayed}
                      </td>
                      {tableCategories.map((cat) => (
                        <td
                          key={cat}
                          className="px-3 py-3 text-center font-mono text-slate-300"
                        >
                          {formatStat(player, cat)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-950/40">
                        <td
                          colSpan={8 + tableCategories.length}
                          className="px-6 py-4"
                        >
                          <ExpandedPlayerPanel
                            player={player}
                            cats={cats}
                            playerDetails={playerDetails}
                            detailsLoading={details === null && !detailsError}
                            detailsError={detailsError && details === null}
                            linkCopied={copiedPlayerId === player.id}
                            onCopyLink={() => {
                              const url = rankingsShareUrl(
                                window.location.origin,
                                pathname,
                                {
                                  position,
                                  query: deferredQuery,
                                  sortKey,
                                  sortDir,
                                  playerId: player.id,
                                  hideDepthGoalies,
                                  statRanges,
                                },
                              );
                              void copyText(url).then((ok) => {
                                if (!ok) return;
                                setCopiedPlayerId(player.id);
                                window.setTimeout(
                                  () => setCopiedPlayerId(null),
                                  1600,
                                );
                              });
                            }}
                            onDetailsLoaded={(d) => {
                              setDetailsError(false);
                              setDetails(d);
                            }}
                            onDetailsError={() => setDetailsError(true)}
                            onClearDetailsError={() => setDetailsError(false)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <RankingsEmptyState
            query={query}
            activeFilterCount={activeFilterCount}
            position={position}
            onClearSearch={() => setQuery("")}
            onClearStatFilters={clearStatFilters}
            onShowAllPositions={() =>
              startTransition(() => setPosition("ALL"))
            }
            onResetBoard={resetBoardView}
          />
        )}
        {filtered.length > renderCount && (
          <div
            ref={loadMoreRef}
            className="border-t border-white/5 px-6 py-4 text-center text-xs text-slate-500"
            aria-hidden
          >
            Loading more…
          </div>
        )}
      </div>
      <p
        className="text-center text-xs text-slate-500"
        aria-live="polite"
        aria-atomic="true"
      >
        Showing {formatCount(Math.min(renderCount, filtered.length))} of{" "}
        {formatCount(filtered.length)} matching players (
        {formatCount(players.length)} total). Click a row for category
        breakdown. Click column headers to sort. Press / to focus search, r to
        reset, ? for shortcuts. Esc closes help/filters then the open row; with
        a row open use j/k or ↑/↓.
      </p>
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
