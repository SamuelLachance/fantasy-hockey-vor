import type { ProjectionsDataset } from "@/lib/types";
import { Trophy, Target, Shield, Zap } from "lucide-react";
import { PositionBadge } from "./PositionBadge";
import { vorColor } from "@/lib/format";

interface TopPlayersProps {
  players: ProjectionsDataset["players"];
}

export function TopPlayers({ players }: TopPlayersProps) {
  const topOverall = players.slice(0, 5);
  const topByPosition = (["C", "LW", "RW", "D", "G"] as const).map((pos) => ({
    position: pos,
    players: players.filter((p) => p.position === pos).slice(0, 3),
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
                <PositionBadge position={player.position} />
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
                    <span className={`font-mono ${vorColor(p.vor)}`}>
                      {p.vor.toFixed(1)}
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
              Each stat is converted to a z-score across the player pool, then
              summed for total fantasy value.
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
            <h3 className="font-medium text-white">AI Projections</h3>
            <p className="mt-1 text-sm text-slate-400">
              Each player dossier includes bio, draft rank, team strength, team
              changes, injury history, contract stage, and advanced stats. OpenAI
              analyzes the full context to predict next-season category totals.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
