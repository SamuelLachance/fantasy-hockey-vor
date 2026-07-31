import type { LeagueSettings, ProjectionsDataset } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import {
  edgeColor,
  formatSigned,
  sigmaColor,
  vorColor,
} from "@/lib/format";
import { DEFAULT_LEAGUE } from "@/lib/league";
import { Trophy, Target, Zap, Gauge } from "lucide-react";
import { steadiestSkaters, topEdgeSkaters } from "@/lib/top-lists";
import { vorForFilter } from "@/lib/rankings-filters";
import { topByPositionLeaders } from "@/lib/goalie-depth";
import {
  TOP_LEADERS_COPY,
  topLeadersSectionLabel,
} from "@/lib/top-leaders-copy";
import {
  edgeBoardHref,
  playerBoardHref,
  sigmaBoardHref,
  steadiestBoardHref,
} from "@/lib/rankings-url";
import { HowVorWorks } from "./HowVorWorks";
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
    <section
      aria-label={topLeadersSectionLabel()}
      className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3"
    >
      <TopLeadersCard
        icon={<Trophy className="h-5 w-5" />}
        title={TOP_LEADERS_COPY.overallVor.title}
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
        title={TOP_LEADERS_COPY.topEdge.title}
        accentClass="text-emerald-400"
        description={TOP_LEADERS_COPY.topEdge.description}
        headerExtra={
          <div className="flex items-center gap-3 text-xs">
            <a
              href={edgeBoardHref()}
              className="text-slate-500 underline-offset-2 transition hover:text-emerald-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/80"
            >
              {TOP_LEADERS_COPY.sortByEdge}
            </a>
            <a
              href={sigmaBoardHref()}
              className="text-slate-500 underline-offset-2 transition hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              {TOP_LEADERS_COPY.sortBySigma}
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
          title={TOP_LEADERS_COPY.steadiest.title}
          accentClass="text-cyan-400"
          className="lg:col-span-2 xl:col-span-1"
          description={TOP_LEADERS_COPY.steadiest.description}
          headerExtra={
            <a
              href={steadiestBoardHref()}
              className="text-xs text-slate-500 underline-offset-2 transition hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              {TOP_LEADERS_COPY.boardView}
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
        title={TOP_LEADERS_COPY.byPosition.title}
        accentClass="text-cyan-400"
        className="lg:col-span-2 xl:col-span-3"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          {topByPosition.map(({ position, players: posPlayers }) => (
            <div key={position} className="rounded-xl border border-white/5 p-3">
              <div className="mb-2 flex items-center gap-2">
                <PositionBadge position={position} />
                <span className="text-xs text-slate-500">
                  {TOP_LEADERS_COPY.top3}
                </span>
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

      <HowVorWorks
        teams={teams}
        league={league}
        categoryWeights={categoryWeights}
      />
    </section>
  );
}
