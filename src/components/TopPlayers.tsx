import type { ProjectionsDataset } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import { CATEGORY_FULL_LABELS } from "@/lib/format";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "@/lib/types";
import { Trophy, Target, Shield, Zap } from "lucide-react";
import { PositionBadge, PositionBadges } from "./PositionBadge";
import { vorColor } from "@/lib/format";

interface TopPlayersProps {
  players: ProjectionsDataset["players"];
  categoryWeights?: CategoryDifficultyWeights;
}

function vorAtPosition(
  player: ProjectionsDataset["players"][number],
  position: ProjectionsDataset["players"][number]["position"],
): number {
  return player.vorByPosition?.[position] ?? player.vor;
}

export function TopPlayers({ players, categoryWeights }: TopPlayersProps) {
  const topOverall = players.slice(0, 5);
  const topByPosition = (["C", "LW", "RW", "D", "G"] as const).map((pos) => ({
    position: pos,
    players: players
      .filter((p) => p.positions.includes(pos))
      .sort((a, b) => vorAtPosition(b, pos) - vorAtPosition(a, pos))
      .slice(0, 3),
  }));

  return (
    <section className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6">
        <div className="mb-4 flex items-center gap-2 text-amber-400">
          <Trophy className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-white">Overall VOR Leaders</h2>
        </div>
        <ul className="space-y-3">
          {topOverall.map((player) => (
            <li
              key={player.id}
              className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm text-slate-500">
                  {player.rank}
                </span>
                <div>
                  <div className="font-medium text-white">{player.name}</div>
                  <div className="text-xs text-slate-400">{player.team}</div>
                </div>
                <PositionBadges
                  positions={player.positions}
                  vorPosition={player.vorPosition ?? player.position}
                />
              </div>
              <span className={`font-mono font-bold ${vorColor(player.vor)}`}>
                {player.vor >= 0 ? "+" : ""}
                {player.vor.toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6">
        <div className="mb-4 flex items-center gap-2 text-cyan-400">
          <Target className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-white">By Position</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {topByPosition.map(({ position, players: posPlayers }) => (
            <div key={position} className="rounded-xl border border-white/5 p-3">
              <div className="mb-2 flex items-center gap-2">
                <PositionBadge position={position} />
                <span className="text-xs text-slate-500">Top 3</span>
              </div>
              <ul className="space-y-2">
                {posPlayers.map((p) => (
                  <li
                    key={p.id}
                    className="flex justify-between text-sm text-slate-300"
                  >
                    <span className="truncate pr-2">{p.name}</span>
                    <span className={`font-mono ${vorColor(vorAtPosition(p, position))}`}>
                      {vorAtPosition(p, position).toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-950/30 to-slate-950/80 p-6 lg:col-span-2">
        <div className="mb-4 flex items-center gap-2 text-emerald-400">
          <Shield className="h-5 w-5" />
          <h2 className="text-lg font-semibold text-white">How VOR Works</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <Zap className="mb-2 h-5 w-5 text-cyan-400" />
            <h3 className="font-medium text-white">Category Z-Scores</h3>
            <p className="mt-1 text-sm text-slate-400">
              Each stat is converted to a z-score against the draftable pool,
              multiplied by a bounded scarcity weight and summed for total
              fantasy value. Goalie SV% is volume-weighted, and goalie value
              is discounted for weekly H2H volatility and streamability.
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <Target className="mb-2 h-5 w-5 text-cyan-400" />
            <h3 className="font-medium text-white">Replacement Level</h3>
            <p className="mt-1 text-sm text-slate-400">
              Based on a 12-team league: C/LW/RW rank 24, D rank 48, G rank
              24 at each position.
            </p>
          </div>
          <div className="rounded-xl border border-white/5 bg-white/5 p-4">
            <Trophy className="mb-2 h-5 w-5 text-cyan-400" />
            <h3 className="font-medium text-white">Yahoo Positions</h3>
            <p className="mt-1 text-sm text-slate-400">
              VOR uses Yahoo Fantasy eligibility. Multi-position players get
              VOR at their best eligible slot; position filters show VOR at that
              position.
            </p>
          </div>
        </div>
        {categoryWeights && (
          <div className="mt-6 rounded-xl border border-white/5 bg-white/5 p-4">
            <h3 className="mb-3 text-sm font-medium text-white">
              Category scarcity weights (skaters)
            </h3>
            <p className="mb-3 text-xs text-slate-400">
              Higher weight = harder to generate vs replacement; counts more toward VOR.
            </p>
            <div className="flex flex-wrap gap-2">
              {SKATER_CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-300"
                >
                  {CATEGORY_FULL_LABELS[cat]}:{" "}
                  <span className="font-mono text-cyan-300">
                    {categoryWeights.skater[cat].weight.toFixed(2)}×
                  </span>
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {GOALIE_CATEGORIES.map((cat) => (
                <span
                  key={cat}
                  className="rounded-lg border border-white/10 bg-slate-900/60 px-2 py-1 text-xs text-slate-300"
                >
                  {CATEGORY_FULL_LABELS[cat]}:{" "}
                  <span className="font-mono text-violet-300">
                    {categoryWeights.goalie[cat].weight.toFixed(2)}×
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
