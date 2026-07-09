"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Filter, X } from "lucide-react";
import {
  GOALIE_CATEGORIES,
  type Category,
  type PlayerProjection,
  type Position,
} from "@/lib/types";
import {
  CATEGORY_FULL_LABELS,
  CATEGORY_LABELS,
  formatStat,
  playerCategories,
  projectionStatValue,
  skaterCategoriesForFilter,
  vorColor,
} from "@/lib/format";
import { PositionBadges } from "./PositionBadge";

type CoreSortKey = "rank" | "vor" | "name" | "team" | "gamesPlayed";
type SortKey = CoreSortKey | Category;

type CoreRangeKey = "gamesPlayed" | "vor";
type RangeKey = CoreRangeKey | Category;

type StatRanges = Partial<Record<RangeKey, { min: string; max: string }>>;

interface RankingsTableProps {
  players: PlayerProjection[];
}

interface PlayerDetails {
  reasoning: string;
  profileSummary: string;
}

const POSITIONS: Array<Position | "ALL"> = ["ALL", "C", "LW", "RW", "D", "G"];
const PAGE_SIZE = 100;

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

let detailsPromise: Promise<Record<string, PlayerDetails>> | null = null;

function fetchPlayerDetails(): Promise<Record<string, PlayerDetails>> {
  detailsPromise ??= fetch("player-details.json")
    .then((res) => (res.ok ? res.json() : {}))
    .catch(() => ({}));
  return detailsPromise;
}

function vorForFilter(player: PlayerProjection, filter: Position | "ALL"): number {
  if (filter !== "ALL") {
    return player.vorByPosition?.[filter] ?? player.vor;
  }
  return player.vor;
}

function parseRangeValue(key: RangeKey, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const v = Number(trimmed);
  if (!Number.isFinite(v)) return undefined;
  if (key === "savePct" && v > 1) return v / 100;
  return v;
}

function coreValue(player: PlayerProjection, key: CoreRangeKey, position: Position | "ALL"): number {
  if (key === "vor") return vorForFilter(player, position);
  return player.gamesPlayed;
}

function passesRanges(
  player: PlayerProjection,
  ranges: StatRanges,
  position: Position | "ALL",
): boolean {
  for (const [key, bounds] of Object.entries(ranges) as [RangeKey, { min: string; max: string }][]) {
    if (!bounds?.min && !bounds?.max) continue;

    const min = bounds.min ? parseRangeValue(key, bounds.min) : undefined;
    const max = bounds.max ? parseRangeValue(key, bounds.max) : undefined;
    if (min == null && max == null) continue;

    let value: number | null;
    if (key === "gamesPlayed" || key === "vor") {
      value = coreValue(player, key, position);
    } else {
      value = projectionStatValue(player, key);
    }
    if (value == null) return false;
    if (min != null && value < min) return false;
    if (max != null && value > max) return false;
  }
  return true;
}

function rangeLabel(key: RangeKey): string {
  if (key === "gamesPlayed") return "Games Played";
  if (key === "vor") return "VOR";
  return CATEGORY_FULL_LABELS[key];
}

function defaultSortDir(key: SortKey): "asc" | "desc" {
  return key === "name" || key === "team" ? "asc" : "desc";
}

export function RankingsTable({ players }: RankingsTableProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("vor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [statRanges, setStatRanges] = useState<StatRanges>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [details, setDetails] = useState<Record<string, PlayerDetails> | null>(
    null,
  );

  const filterRangeKeys = useMemo((): RangeKey[] => {
    const cats =
      position === "G" ? GOALIE_CATEGORIES : skaterCategoriesForFilter(position);
    return ["gamesPlayed", "vor", ...cats];
  }, [position]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    for (const key of filterRangeKeys) {
      const b = statRanges[key];
      if (b?.min?.trim() || b?.max?.trim()) n++;
    }
    return n;
  }, [statRanges, filterRangeKeys]);

  const filterKey = `${position}|${query.trim().toLowerCase()}|${JSON.stringify(statRanges)}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey);
    setVisibleCount(PAGE_SIZE);
  }

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
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

    list = list.filter((p) => passesRanges(p, statRanges, position));

    return [...list].sort((a, b) => {
      let av: number | string;
      let bv: number | string;

      if (sortKey === "vor") {
        av = vorForFilter(a, position);
        bv = vorForFilter(b, position);
      } else if (
        sortKey === "rank" ||
        sortKey === "name" ||
        sortKey === "team" ||
        sortKey === "gamesPlayed"
      ) {
        av = a[sortKey];
        bv = b[sortKey];
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
  }, [players, query, position, sortKey, sortDir, statRanges]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(defaultSortDir(key));
    }
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
        <div className="flex flex-wrap gap-2">
          {POSITIONS.map((pos) => (
            <button
              key={pos}
              onClick={() => setPosition(pos)}
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
            <thead className="border-b border-white/10 bg-slate-950/60 text-xs uppercase tracking-wider text-slate-400">
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
                        {position === "ALL" ? player.rank : idx + 1}
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
                        <td colSpan={6 + tableCategories.length} className="px-6 py-4">
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
                                  ? "ML time-series"
                                  : "Contextual model"}
                            </span>
                            {player.confidence != null && (
                              <span className="text-xs text-slate-400">
                                Confidence: {(player.confidence * 100).toFixed(0)}%
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
        Showing {Math.min(visibleCount, filtered.length).toLocaleString()} of{" "}
        {filtered.length.toLocaleString()} matching players (
        {players.length.toLocaleString()} total). Click a row for category
        breakdown. Click column headers to sort.
      </p>
    </div>
  );
}
