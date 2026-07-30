"use client";

import {
  Fragment,
  Suspense,
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Download, Filter, X } from "lucide-react";
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
  rangeLabel,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import { downloadTextFile, rankingsToCsv } from "@/lib/rankings-csv";
import { parseRankingsUrl, rankingsUrlSearch } from "@/lib/rankings-url";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import { PositionBadges } from "./PositionBadge";

interface RankingsTableProps {
  players: PlayerProjection[];
}

const POSITIONS: Array<Position | "ALL"> = ["ALL", "C", "LW", "RW", "D", "G"];
/** Initial paint budget — “Load more” still grows by this step. */
const PAGE_SIZE = 50;

function SortIcon({
  column,
  sortKey,
  sortDir,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
}) {
  if (sortKey !== column) {
    return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
  }
  return sortDir === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-cyan-400" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-cyan-400" />
  );
}

let detailsPromise: Promise<Record<string, PlayerDetailRecord>> | null = null;

function fetchPlayerDetails(): Promise<Record<string, PlayerDetailRecord>> {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const url = `${base}/player-details.json`.replace(/\/{2,}/g, "/");
  detailsPromise ??= fetch(url)
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return detailsPromise;
}

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
  const [expandedId, setExpandedId] = useState<number | null>(null);
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
    });
    const current = rankingsUrlSearch(parseRankingsUrl(searchParams));
    if (next === current) return;
    router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
  }, [position, deferredQuery, sortKey, sortDir, pathname, router, searchParams]);

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

  useEffect(() => {
    if (expandedId == null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpandedId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expandedId]);

  const filtered = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    let list = players;

    if (position !== "ALL") {
      list = list.filter((p) => p.positions.includes(position));
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
  }, [players, deferredQuery, position, sortKey, sortDir, statRanges, filterRangeKeys]);

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

  function onPositionTabKeyDown(e: KeyboardEvent, index: number) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") {
      return;
    }
    e.preventDefault();
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % POSITIONS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + POSITIONS.length) % POSITIONS.length;
    else if (e.key === "Home") next = 0;
    else next = POSITIONS.length - 1;
    startTransition(() => setPosition(POSITIONS[next]!));
    const tabs = (e.currentTarget.parentElement as HTMLElement | null)?.querySelectorAll(
      '[role="tab"]',
    );
    const el = tabs?.[next] as HTMLElement | undefined;
    el?.focus();
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
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Filter by position"
        >
          {POSITIONS.map((pos, index) => (
            <button
              key={pos}
              type="button"
              role="tab"
              aria-selected={position === pos}
              tabIndex={position === pos ? 0 : -1}
              onClick={() => startTransition(() => setPosition(pos))}
              onKeyDown={(e) => onPositionTabKeyDown(e, index)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                position === pos
                  ? "bg-cyan-500 text-slate-950"
                  : "bg-white/5 text-slate-300 hover:bg-white/10"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-col gap-2 sm:max-w-md sm:flex-row">
          <input
            type="search"
            aria-label="Search players or teams"
            placeholder="Search players or teams..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
          />
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
              filtersOpen || activeFilterCount > 0
                ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
                : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
            }`}
          >
            <Filter className="h-4 w-4" />
            Stats
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-cyan-500 px-1.5 py-0.5 text-xs font-bold text-slate-950">
                {activeFilterCount}
              </span>
            )}
          </button>
          <button
            type="button"
            disabled={filtered.length === 0}
            onClick={() => {
              const csv = rankingsToCsv(filtered, position, tableCategories);
              const stamp = new Date().toISOString().slice(0, 10);
              downloadTextFile(
                `vor-rankings-${position.toLowerCase()}-${stamp}.csv`,
                csv,
                "text/csv;charset=utf-8",
              );
            }}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            title="Download filtered rankings as CSV"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
        </div>
      </div>

      {filtersOpen && (
        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-white">Filter by stats</h3>
              <p className="text-xs text-slate-500">
                Set min/max for any column. Save % accepts 91.5 or 0.915.
              </p>
            </div>
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={clearStatFilters}
                className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
                Clear all
              </button>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filterRangeKeys.map((key) => (
              <div
                key={key}
                className="rounded-xl border border-white/5 bg-white/5 p-3"
              >
                <div className="mb-2 text-xs font-medium text-slate-300">
                  {rangeLabel(key)}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Min"
                    value={statRanges[key]?.min ?? ""}
                    onChange={(e) => updateRange(key, "min", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none"
                  />
                  <span className="text-slate-600">–</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    placeholder="Max"
                    value={statRanges[key]?.max ?? ""}
                    onChange={(e) => updateRange(key, "max", e.target.value)}
                    className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/50 shadow-2xl shadow-cyan-950/20">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="sticky top-0 z-10 border-b border-white/10 bg-slate-950/95 text-xs uppercase tracking-wider text-slate-400 backdrop-blur-sm">
              <tr>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("rank")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    # <SortIcon column="rank" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Player <SortIcon column="name" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">Pos</th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("team")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Team <SortIcon column="team" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("vor")}
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
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Edge <SortIcon column="draftValue" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("gamesPlayed")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    GP <SortIcon column="gamesPlayed" sortKey={sortKey} sortDir={sortDir} />
                  </button>
                </th>
                {tableCategories.map((cat) => (
                  <th key={cat} className="px-3 py-3 text-center">
                    <button
                      onClick={() => toggleSort(cat)}
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
              {filtered.slice(0, visibleCount).map((player, idx) => {
                const isExpanded = expandedId === player.id;
                const cats = playerCategories(player);
                const playerDetails = details?.[String(player.id)];
                return (
                  <Fragment key={player.id}>
                    <tr
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
                                    {playerDetails?.perStatUncertainty?.[cat]
                                      ?.sigma != null &&
                                      cat !== "savePct" && (
                                        <span className="ml-1 text-xs font-normal text-slate-500">
                                          ±
                                          {playerDetails.perStatUncertainty[
                                            cat
                                          ]!.sigma.toFixed(
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
            No players match your filters.
          </div>
        )}
        {filtered.length > visibleCount && (
          <div className="border-t border-white/5 px-6 py-4 text-center">
            <button
              onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              className="rounded-full bg-white/5 px-6 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
            >
              Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
            </button>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-slate-500">
        Showing {formatCount(Math.min(visibleCount, filtered.length))} of{" "}
        {formatCount(filtered.length)} matching players (
        {formatCount(players.length)} total). Click a row for category
        breakdown. Click column headers to sort.
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
