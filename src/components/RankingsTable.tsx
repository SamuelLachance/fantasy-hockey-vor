"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { PlayerProjection, Position } from "@/lib/types";
import {
  CATEGORY_LABELS,
  formatStat,
  playerCategories,
  vorColor,
} from "@/lib/format";
import { PositionBadge } from "./PositionBadge";

type SortKey = "rank" | "vor" | "name" | "team" | "gamesPlayed";

interface RankingsTableProps {
  players: PlayerProjection[];
}

const POSITIONS: Array<Position | "ALL"> = ["ALL", "C", "LW", "RW", "D", "G"];

export function RankingsTable({ players }: RankingsTableProps) {
  const [query, setQuery] = useState("");
  const [position, setPosition] = useState<Position | "ALL">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("vor");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

    return [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "string" && typeof bv === "string") {
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      }
      return sortDir === "asc"
        ? Number(av) - Number(bv)
        : Number(bv) - Number(av);
    });
  }, [players, query, position, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "name" || key === "team" ? "asc" : "desc");
    }
  }

  function SortIcon({ column }: { column: SortKey }) {
    if (sortKey !== column) {
      return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />;
    }
    return sortDir === "asc" ? (
      <ArrowUp className="h-3.5 w-3.5 text-cyan-400" />
    ) : (
      <ArrowDown className="h-3.5 w-3.5 text-cyan-400" />
    );
  }

  const samplePlayer = filtered[0];
  const categories = samplePlayer ? playerCategories(samplePlayer) : [];

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
        <input
          type="search"
          placeholder="Search players or teams..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-500/50 focus:outline-none focus:ring-2 focus:ring-cyan-500/20 sm:max-w-xs"
        />
      </div>

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
                    # <SortIcon column="rank" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("name")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Player <SortIcon column="name" />
                  </button>
                </th>
                <th className="px-4 py-3">Pos</th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("team")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    Team <SortIcon column="team" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("vor")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    VOR <SortIcon column="vor" />
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => toggleSort("gamesPlayed")}
                    className="inline-flex items-center gap-1 hover:text-white"
                  >
                    GP <SortIcon column="gamesPlayed" />
                  </button>
                </th>
                {categories.map((cat) => (
                  <th key={cat} className="px-3 py-3 text-center">
                    {CATEGORY_LABELS[cat]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filtered.map((player, idx) => {
                const isExpanded = expandedId === player.id;
                const cats = playerCategories(player);
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
                        <PositionBadge position={player.position} />
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-300">
                        {player.team}
                      </td>
                      <td
                        className={`px-4 py-3 font-mono font-semibold ${vorColor(player.vor)}`}
                      >
                        {player.vor >= 0 ? "+" : ""}
                        {player.vor.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-400">
                        {player.gamesPlayed}
                      </td>
                      {cats.map((cat) => (
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
                        <td colSpan={6 + cats.length} className="px-6 py-4">
                          <div className="mb-4 flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                (player.projectionMethod ?? "contextual") === "ai"
                                  ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
                                  : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
                              }`}
                            >
                              {player.projectionMethod === "ai"
                                ? "AI projection"
                                : "Contextual model"}
                            </span>
                            {player.confidence != null && (
                              <span className="text-xs text-slate-400">
                                Confidence: {(player.confidence * 100).toFixed(0)}%
                              </span>
                            )}
                          </div>
                          {player.reasoning && (
                            <p className="mb-3 text-sm leading-relaxed text-slate-300">
                              {player.reasoning}
                            </p>
                          )}
                          {player.profileSummary && (
                            <p className="mb-4 rounded-xl border border-white/5 bg-white/5 p-3 text-xs leading-relaxed text-slate-400">
                              {player.profileSummary}
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
      </div>
      <p className="text-center text-xs text-slate-500">
        Showing {filtered.length.toLocaleString()} of{" "}
        {players.length.toLocaleString()} players. Click a row for category
        breakdown.
      </p>
    </div>
  );
}
