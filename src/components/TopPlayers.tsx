import type { LeagueSettings, ProjectionsDataset } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import {
  CATEGORY_FULL_LABELS,
  edgeColor,
  formatSigned,
  sigmaColor,
  vorColor,
} from "@/lib/format";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "@/lib/types";
import { DEFAULT_LEAGUE, replacementRank } from "@/lib/league";
import { Trophy, Target, Shield, Zap, Gauge } from "lucide-react";
import { steadiestSkaters, topEdgeSkaters } from "@/lib/top-lists";
import { vorForFilter } from "@/lib/rankings-filters";
import { topByPositionLeaders } from "@/lib/goalie-depth";
import {
  edgeBoardHref,
  playerBoardHref,
  sigmaBoardHref,
  steadiestBoardHref,
} from "@/lib/rankings-url";
import { PositionBadge, PositionBadges } from "./PositionBadge";
import { TopLeadersCard } from "./TopLeadersCard";
import { TopPlayerLink } from "./TopPlayerLink";

interface TopPlayersProps {
  players: ProjectionsDataset["players"];
  categoryWeights?: CategoryDifficultyWeights;
  league?: LeagueSettings;
}

export function TopPlayers({
  players,
  categoryWeights,
  league = DEFAULT_LEAGUE,
}: TopPlayersProps) {
  const topOverall = players.slice(0, 5);
  const teams = league.teams;
  const topEdge = topEdgeSkaters(players);
  const steadiest = steadiestSkaters(players);
  const topByPosition = topByPositionLeaders(players);

  return (
    <section className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
      <TopLeadersCard
        icon={<Trophy className="h-5 w-5" />}
        title="Overall VOR Leaders"
        accentClass="text-amber-400"
      >
        <ul className="space-y-3">
          {topOverall.map((player) => (
            <li key={player.id}>
              <TopPlayerLink
                href={playerBoardHref(player.id)}
                accent="amber"
                trailing={
                  <div className="text-right">
                    <div
                      className={`font-mono tabular-nums font-bold ${vorColor(player.vor)}`}
                    >
                      {formatSigned(player.vor, { digits: 2, plusZero: true })}
                    </div>
                    {player.uncertainty?.total?.sigma != null && (
                      <div
                        className={`font-mono tabular-nums text-xs ${sigmaColor(player.uncertainty.total.sigma)}`}
                      >
                        Σσ {player.uncertainty.total.sigma.toFixed(0)}
                      </div>
                    )}
                  </div>
                }
              >
                <span className="font-mono tabular-nums text-sm text-slate-500">
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
              </TopPlayerLink>
            </li>
          ))}
        </ul>
      </TopLeadersCard>

      <TopLeadersCard
        icon={<Zap className="h-5 w-5" />}
        title="Top Edge (undervalued)"
        accentClass="text-emerald-400"
        description="Consensus rank − model rank. Positive = model likes them more than the synthetic market."
        headerExtra={
          <div className="flex items-center gap-3 text-xs">
            <a
              href={edgeBoardHref()}
              className="text-slate-500 underline-offset-2 transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
            >
              Sort by Edge
            </a>
            <a
              href={sigmaBoardHref()}
              className="text-slate-500 underline-offset-2 transition hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Sort by Σσ
            </a>
          </div>
        }
      >
        <ul className="space-y-3">
          {topEdge.map((player) => (
            <li key={player.id}>
              <TopPlayerLink
                href={playerBoardHref(player.id)}
                accent="emerald"
                trailing={
                  <span
                    className={`font-mono tabular-nums font-bold ${edgeColor(player.draftValue ?? 0)}`}
                  >
                    {formatSigned(player.draftValue ?? 0)}
                  </span>
                }
              >
                <span className="font-mono tabular-nums text-sm text-slate-500">
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
              </TopPlayerLink>
            </li>
          ))}
        </ul>
      </TopLeadersCard>

      {steadiest.length > 0 && (
        <TopLeadersCard
          icon={<Gauge className="h-5 w-5" />}
          title="Steadiest (low Σσ)"
          accentClass="text-cyan-400"
          className="lg:col-span-2 xl:col-span-1"
          description="Among skaters with VOR ≥ 2, the five with the tightest Σσ bands."
          headerExtra={
            <a
              href={steadiestBoardHref()}
              className="text-xs text-slate-500 underline-offset-2 transition hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Board view
            </a>
          }
        >
          <ul className="space-y-3">
            {steadiest.map((player) => (
              <li key={player.id}>
                <TopPlayerLink
                  href={playerBoardHref(player.id)}
                  trailing={
                    <span
                      className={`font-mono tabular-nums font-bold ${sigmaColor(player.uncertainty!.total.sigma)}`}
                    >
                      Σσ {player.uncertainty!.total.sigma.toFixed(0)}
                    </span>
                  }
                >
                  <span className="font-mono tabular-nums text-sm text-slate-500">
                    #{player.rank}
                  </span>
                  <div>
                    <div className="font-medium text-white">{player.name}</div>
                    <div className="text-xs text-slate-400">
                      {player.team} · VOR{" "}
                      {formatSigned(player.vor, { digits: 1, plusZero: true })}
                    </div>
                  </div>
                </TopPlayerLink>
              </li>
            ))}
          </ul>
        </TopLeadersCard>
      )}

      <TopLeadersCard
        icon={<Target className="h-5 w-5" />}
        title="By Position"
        accentClass="text-cyan-400"
        className="lg:col-span-2 xl:col-span-3"
      >
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
                    <TopPlayerLink
                      href={playerBoardHref(p.id)}
                      accent="cyan"
                      dense
                      trailing={
                        <span
                          className={`shrink-0 font-mono tabular-nums ${vorColor(vorForFilter(p, position))}`}
                        >
                          {formatSigned(vorForFilter(p, position), {
                            digits: 1,
                            plusZero: true,
                          })}
                        </span>
                      }
                    >
                      <span className="truncate text-sm text-slate-300">
                        {p.name}
                        {position === "G" ? (
                          <span className="ml-1 text-xs text-slate-500">
                            {p.gamesPlayed}gp
                          </span>
                        ) : null}
                      </span>
                    </TopPlayerLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </TopLeadersCard>

      <div className="rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-950/30 to-slate-950/80 p-6 lg:col-span-2 xl:col-span-3">
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
                  <span className="font-mono tabular-nums text-cyan-300">
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
                  <span className="font-mono tabular-nums text-violet-300">
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
