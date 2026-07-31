import type { LeagueSettings, ProjectionsDataset } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import { CATEGORY_FULL_LABELS, edgeColor, vorColor } from "@/lib/format";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "@/lib/types";
import { DEFAULT_LEAGUE, replacementRank } from "@/lib/league";
import { Trophy, Target, Shield, Zap } from "lucide-react";
import { PositionBadge, PositionBadges } from "./PositionBadge";

function playerHref(id: number): string {
  return `?player=${id}#rankings`;
}

interface TopPlayersProps {
  players: ProjectionsDataset["players"];
  categoryWeights?: CategoryDifficultyWeights;
  league?: LeagueSettings;
}

function vorAtPosition(
  player: ProjectionsDataset["players"][number],
  position: ProjectionsDataset["players"][number]["position"],
): number {
  return player.vorByPosition?.[position] ?? player.vor;
}

export function TopPlayers({
  players,
  categoryWeights,
  league = DEFAULT_LEAGUE,
}: TopPlayersProps) {
  const topOverall = players.slice(0, 5);
  const teams = league.teams;
  const topEdge = [...players]
    .filter((p) => !p.isGoalie && (p.draftValue ?? 0) > 0)
    .sort((a, b) => (b.draftValue ?? 0) - (a.draftValue ?? 0))
    .slice(0, 5);
  const topByPosition = (["C", "LW", "RW", "D", "G"] as const).map((pos) => ({
    position: pos,
    players: players
      .filter((p) => p.positions.includes(pos))
      .filter((p) => pos !== "G" || p.gamesPlayed > 8)
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
            <li key={player.id}>
              <a
                href={playerHref(player.id)}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 transition hover:border-cyan-500/30 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
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
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-emerald-400">
            <Zap className="h-5 w-5" />
            <h2 className="text-lg font-semibold text-white">
              Top Edge (undervalued)
            </h2>
          </div>
          <a
            href="?sort=draftValue#rankings"
            className="text-xs text-slate-500 underline-offset-2 transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
          >
            Sort by Edge
          </a>
        </div>
        <p className="mb-3 text-xs text-slate-500">
          Consensus rank − model rank. Positive = model likes them more than
          the synthetic market.
        </p>
        <ul className="space-y-3">
          {topEdge.map((player) => (
            <li key={player.id}>
              <a
                href={playerHref(player.id)}
                className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3 transition hover:border-emerald-500/30 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-slate-500">
                    #{player.rank}
                  </span>
                  <div>
                    <div className="font-medium text-white">{player.name}</div>
                    <div className="text-xs text-slate-400">
                      {player.team}
                      {player.syntheticMarketRank != null
                        ? ` · mkt #${player.syntheticMarketRank}`
                        : ""}
                    </div>
                  </div>
                </div>
                <span
                  className={`font-mono font-bold ${edgeColor(player.draftValue ?? 0)}`}
                >
                  +{player.draftValue}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-6 lg:col-span-2">
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
                  <li key={p.id}>
                    <a
                      href={playerHref(p.id)}
                      className="flex justify-between gap-2 rounded-md text-sm text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
                    >
                      <span className="truncate">
                        {p.name}
                        {position === "G" ? (
                          <span className="ml-1 text-xs text-slate-500">
                            {p.gamesPlayed}gp
                          </span>
                        ) : null}
                      </span>
                      <span
                        className={`shrink-0 font-mono ${vorColor(vorAtPosition(p, position))}`}
                      >
                        {vorAtPosition(p, position).toFixed(1)}
                      </span>
                    </a>
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
              Based on a {teams}-team league: C/LW/RW rank{" "}
              {replacementRank("C", teams, league.roster)}, D rank{" "}
              {replacementRank("D", teams, league.roster)}, G rank{" "}
              {replacementRank("G", teams, league.roster)} at each position.
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
