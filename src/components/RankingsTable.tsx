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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  GOALIE_CATEGORIES,
  type Category,
  type PlayerProjection,
  type Position,
} from "@/lib/types";
import {
  CATEGORY_LABELS,
  edgeColor,
  formatCount,
  formatStat,
  playerCategories,
  projectionStatValue,
  skaterCategoriesForFilter,
  vorColor,
} from "@/lib/format";
import {
  defaultSortDir,
  passesRanges,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import { parseRankingsUrl, rankingsUrlSearch } from "@/lib/rankings-url";
import { fetchPlayerDetails } from "@/lib/player-details-client";
import {
  detailStatSigma,
  type PlayerDetailRecord,
} from "@/lib/publish-players";
import { PositionBadges } from "./PositionBadge";
import { RankingsStatFilters } from "./RankingsStatFilters";
import { RankingsToolbar } from "./RankingsToolbar";
import { SortIcon } from "./SortIcon";

interface RankingsTableProps {
  players: PlayerProjection[];
}

/** Initial paint budget — infinite scroll grows by this step. */
const PAGE_SIZE = 50;

function RankingsTableInner({ players }: RankingsTableProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [seed] = useState(() => parseRankingsUrl(searchParams));
  const [query, setQuery] = useState(seed.query);
  const deferredQuery = useDeferredValue(query);
  const [position, setPosition] = useState<Position | "ALL">(seed.position);
  const [sortKey, setSortKey] = useState<SortKey>(seed.sortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(seed.sortDir);
  const [statRanges, setStatRanges] = useState<StatRanges>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [hideDepthGoalies, setHideDepthGoalies] = useState(
    seed.hideDepthGoalies,
  );
  const [expandedId, setExpandedId] = useState<number | null>(seed.playerId);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [details, setDetails] = useState<Record<
    string,
    PlayerDetailRecord
  > | null>(null);

  useEffect(() => {
    const next = rankingsUrlSearch({
      position,
      query: deferredQuery,
      sortKey,
      sortDir,
      playerId: expandedId,
      hideDepthGoalies,
    });
    const current = rankingsUrlSearch(parseRankingsUrl(searchParams));
    if (next === current) return;
    const hash =
      typeof window !== "undefined" && window.location.hash
        ? window.location.hash
        : "";
    router.replace(
      `${pathname}${next ? `?${next}` : ""}${hash}`,
      { scroll: false },
    );
  }, [
    position,
    deferredQuery,
    sortKey,
    sortDir,
    expandedId,
    hideDepthGoalies,
    pathname,
    router,
    searchParams,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash !== "#rankings") return;
    document.getElementById("rankings")?.scrollIntoView({ block: "start" });
  }, []);

  const filterRangeKeys = useMemo((): RangeKey[] => {
    const cats =
      position === "G" ? GOALIE_CATEGORIES : skaterCategoriesForFilter(position);
    return ["gamesPlayed", "vor", "draftValue", ...cats];
  }, [position]);

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
    const cats =
      position === "G" ? GOALIE_CATEGORIES : skaterCategoriesForFilter(position);
    if (
      sortKey !== "rank" &&
      sortKey !== "vor" &&
      sortKey !== "name" &&
      sortKey !== "team" &&
      sortKey !== "gamesPlayed" &&
      sortKey !== "draftValue" &&
      !(cats as readonly string[]).includes(sortKey)
    ) {
      setSortKey("vor");
      setSortDir("desc");
    }
  }

  useEffect(() => {
    // Prefetch notes on idle so the first expand isn't network-bound.
    const ric = window.requestIdleCallback ?? ((cb: IdleRequestCallback) =>
      window.setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 0 } as IdleDeadline), 200));
    const cancel =
      window.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id));
    const id = ric(() => {
      void fetchPlayerDetails().then(setDetails);
    });
    return () => cancel(id as number);
  }, []);

  useEffect(() => {
    if (expandedId != null && details === null) {
      let cancelled = false;
      fetchPlayerDetails().then((d) => {
        if (!cancelled) setDetails(d);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [expandedId, details]);

  const loadMoreRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let list = players;

    if (position !== "ALL") {
      list = list.filter((p) => p.positions.includes(position));
    }

    if (hideDepthGoalies && (position === "G" || position === "ALL")) {
      list = list.filter((p) => !p.isGoalie || p.gamesPlayed > 8);
    }

    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.team.toLowerCase().includes(q),
      );
    }

    list = list.filter((p) => passesRanges(p, statRanges, position, filterRangeKeys));

    return [...list].sort((a, b) => {
      let av: number | string;
      let bv: number | string;

      if (sortKey === "vor") {
        av = vorForFilter(a, position);
        bv = vorForFilter(b, position);
      } else if (sortKey === "rank") {
        av = position === "ALL" ? a.rank : (a.positionRank ?? a.rank);
        bv = position === "ALL" ? b.rank : (b.positionRank ?? b.rank);
      } else if (
        sortKey === "name" ||
        sortKey === "team" ||
        sortKey === "gamesPlayed" ||
        sortKey === "draftValue"
      ) {
        av = sortKey === "draftValue" ? (a.draftValue ?? 0) : a[sortKey];
        bv = sortKey === "draftValue" ? (b.draftValue ?? 0) : b[sortKey];
      } else {
        av = projectionStatValue(a, sortKey) ?? -Infinity;
        bv = projectionStatValue(b, sortKey) ?? -Infinity;
      }

      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      return sortDir === "asc"
        ? Number(av) - Number(bv)
        : Number(bv) - Number(av);
    });
  }, [
    players,
    deferredQuery,
    position,
    sortKey,
    sortDir,
    statRanges,
    filterRangeKeys,
    hideDepthGoalies,
  ]);

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
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [expandedId, renderCount]);

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape") {
        setExpandedId(null);
        return;
      }
      if (expandedId == null) return;
      if (
        e.key !== "j" &&
        e.key !== "k" &&
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp"
      ) {
        return;
      }
      e.preventDefault();
      const idx = filtered.findIndex((p) => p.id === expandedId);
      if (idx < 0) return;
      const next =
        e.key === "j" || e.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next < 0 || next >= filtered.length) return;
      setExpandedId(filtered[next]!.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId, filtered]);

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
    setStatRanges((prev) => ({
      ...prev,
      [key]: { min: "", max: "", ...prev[key], [field]: value },
    }));
  }

  function clearStatFilters() {
    setStatRanges({});
  }

  const tableCategories: readonly Category[] =
    position === "G" ? GOALIE_CATEGORIES : skaterCategoriesForFilter(position);

  return (
    <div id="rankings" className="space-y-4 scroll-mt-6">
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
        />

        {filtersOpen && (
          <RankingsStatFilters
            filterRangeKeys={filterRangeKeys}
            statRanges={statRanges}
            activeFilterCount={activeFilterCount}
            onUpdateRange={updateRange}
            onClear={clearStatFilters}
          />
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-wider text-slate-400 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("rank")}
                    onDoubleClick={resetSortToVor}
                    title="Double-click any header to reset sort to VOR"
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    # <SortIcon column="rank" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("name")}
                    onDoubleClick={resetSortToVor}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Player <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">Pos</th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("team")}
                    onDoubleClick={resetSortToVor}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Team <SortIcon column="team" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("vor")}
                    onDoubleClick={resetSortToVor}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    VOR <SortIcon column="vor" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th
                  className="px-4 py-3"
                  title="Consensus rank − model rank. Positive = undervalued vs synthetic market (Marcel/EWMA/lag1)."
                >
                  <button
                    onClick={() => toggleSort("draftValue")}
                    onDoubleClick={resetSortToVor}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Edge <SortIcon column="draftValue" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("gamesPlayed")}
                    onDoubleClick={resetSortToVor}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    GP <SortIcon column="gamesPlayed" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                {tableCategories.map((cat) => (
                  <th key={cat} className="px-3 py-3 text-center">
                    <button
                      onClick={() => toggleSort(cat)}
                      onDoubleClick={resetSortToVor}
                      className="inline-flex w-full items-center justify-center gap-1 hover:text-white"
                    >
                      {CATEGORY_LABELS[cat]}
                      <SortIcon column={cat} sortKey={sortKey} sortDir={sortDir} />
                    </button>
                  </th>
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
                      style={{ contentVisibility: "auto", containIntrinsicSize: "0 52px" }}
                      onClick={() =>
                        setExpandedId(isExpanded ? null : player.id)
                      }
                      className="cursor-pointer transition hover:bg-cyan-500/5"
                    >
                      <td className="px-4 py-3 font-mono text-slate-400">
                        {position === "ALL"
                          ? player.rank
                          : (player.positionRank ?? idx + 1)}
                      </td>
                      <td className="px-4 py-3 font-medium text-white">
                        {player.name}
                      </td>
                      <td className="px-4 py-3">
                        <PositionBadges
                          positions={player.positions}
                          vorPosition={player.vorPosition ?? player.position}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {player.team}
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
                        <td colSpan={7 + tableCategories.length} className="px-6 py-4">
                          <div className="mb-4 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                player.projectionMethod === "ai"
                                  ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
                                  : player.projectionMethod === "ml"
                                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                                    : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                              }`}
                            >
                              {player.projectionMethod === "ai"
                                ? "AI projection"
                                : player.projectionMethod === "ml"
                                  ? "ML stacked ensemble"
                                  : "Contextual model"}
                            </span>
                            {player.confidence != null && (
                              <span className="text-xs text-slate-400">
                                Confidence: {(player.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                            {player.uncertainty && (
                              <span
                                className="text-xs text-slate-400"
                                title="1σ season-total uncertainty. Aleatoric share = irreducible noise vs model disagreement."
                              >
                                ±{player.uncertainty.gamesPlayedSigma.toFixed(0)} GP
                                {player.uncertainty.total?.sigma != null
                                  ? ` · Σσ ${player.uncertainty.total.sigma.toFixed(1)}`
                                  : ""}
                                {" · "}
                                {(player.uncertainty.aleatoricShare * 100).toFixed(0)}%
                                irreducible
                              </span>
                            )}
                          </div>
                          {playerDetails?.reasoning && (
                            <p className="mb-3 text-sm leading-relaxed text-slate-300">
                              {playerDetails.reasoning}
                            </p>
                          )}
                          {playerDetails?.profileSummary && (
                            <p className="mb-4 rounded-xl border border-white/5 bg-white/5 p-3 text-xs leading-relaxed text-slate-400">
                              {playerDetails.profileSummary}
                            </p>
                          )}
                          {isExpanded && details === null && (
                            <p className="mb-3 text-xs text-slate-500">
                              Loading player notes...
                            </p>
                          )}
                          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {cats.map((cat) => {
                              const z = player.categoryZScores[cat] ?? 0;
                              const width = Math.min(
                                100,
                                Math.max(8, 50 + z * 12),
                              );
                              return (
                                <div
                                  key={cat}
                                  className="rounded-xl border border-white/5 bg-white/5 p-3"
                                >
                                  <div className="mb-1 flex justify-between text-xs text-slate-400">
                                    <span>{CATEGORY_LABELS[cat]}</span>
                                    <span
                                      className={
                                        z >= 0
                                          ? "text-emerald-400"
                                          : "text-rose-400"
                                      }
                                    >
                                      {z >= 0 ? "+" : ""}
                                      {z.toFixed(2)} z
                                    </span>
                                  </div>
                                  <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                                    <div
                                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                                      style={{ width: `${width}%` }}
                                    />
                                  </div>
                                  <div className="mt-1 text-sm font-medium text-white">
                                    Proj: {formatStat(player, cat)}
                                    {detailStatSigma(playerDetails, cat) !=
                                      null &&
                                      cat !== "savePct" && (
                                        <span className="ml-1 text-xs font-normal text-slate-500">
                                          ±
                                          {detailStatSigma(
                                            playerDetails,
                                            cat,
                                          )!.toFixed(
                                            cat === "goals" ||
                                              cat === "assists" ||
                                              cat === "powerplayPoints"
                                              ? 1
                                              : 0,
                                          )}
                                        </span>
                                      )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
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
          <div className="px-6 py-16 text-center text-slate-400">
            <p>No players match your filters.</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {query.trim() !== "" && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10"
                >
                  Clear search
                </button>
              )}
              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={clearStatFilters}
                  className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10"
                >
                  Clear stat filters
                </button>
              )}
              {position !== "ALL" && (
                <button
                  type="button"
                  onClick={() => startTransition(() => setPosition("ALL"))}
                  className="rounded-full bg-white/5 px-4 py-1.5 text-sm text-slate-300 transition hover:bg-white/10"
                >
                  Show all positions
                </button>
              )}
            </div>
          </div>
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
        breakdown. Click column headers to sort. With a row open: j/k or
        ↑/↓ to move, Esc to close.
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
