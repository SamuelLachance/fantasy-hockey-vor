"use client";

import { Snowflake } from "lucide-react";
import { formatCount } from "@/lib/format";
import { scrollToRankings } from "@/lib/board-dom";
import { formatProjectionEngine } from "@/lib/projection-engine-label";
import {
  isProjectionStale,
  isProjectionVeryStale,
} from "@/lib/projection-age";
import { useLiveProjectionAge } from "@/hooks/useLiveProjectionAge";
import {
  headerEyebrowCopy,
  headerHeroTitle,
  headerJumpCtaCopy,
  headerJumpCtaTitle,
  headerLeadCopy,
  headerPlayersStatLabel,
  headerTeamsStatLabel,
  skipToRankingsCopy,
} from "@/lib/header-copy";
import { HeaderRosterNote } from "./HeaderRosterNote";
import { HeaderStaleBanner } from "./HeaderStaleBanner";

interface HeaderProps {
  season: string;
  playerCount: number;
  leagueTeams?: number;
  generatedAt?: string;
  /** Precomputed age in days (from build) — first paint; live age updates after mount. */
  projectionAgeDays?: number;
  projectionEngine?: string;
  aiModel?: string;
}

export function Header({
  season,
  playerCount,
  leagueTeams = 12,
  generatedAt,
  projectionAgeDays = 0,
  projectionEngine,
  aiModel,
}: HeaderProps) {
  const generatedLabel = generatedAt
    ? new Date(generatedAt).toISOString().slice(0, 10)
    : null;
  const ageDays = useLiveProjectionAge(generatedAt, projectionAgeDays);
  const stale = isProjectionStale(ageDays);
  const veryStale = isProjectionVeryStale(ageDays);
  return (
    <header className="relative overflow-hidden border-b border-white/10 bg-slate-950/80 pt-[env(safe-area-inset-top,0px)] backdrop-blur-xl motion-reduce:backdrop-blur-none">
      <a
        href="#rankings"
        onClick={(e) => {
          e.preventDefault();
          scrollToRankings({ focusSearch: true });
        }}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
      >
        {skipToRankingsCopy()}
      </a>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.15),_transparent_55%)]" />
      <div className="pointer-events-none absolute -right-20 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 text-cyan-400">
          <Snowflake className="h-5 w-5" aria-hidden="true" />
          <span className="text-sm font-medium uppercase tracking-[0.2em]">
            {headerEyebrowCopy()}
          </span>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              {headerHeroTitle()}
            </h1>
            <p className="mt-3 max-w-2xl text-lg text-slate-400">
              {headerLeadCopy(season)}
            </p>
            {(projectionEngine || generatedLabel) && (
              <p className="mt-2 text-sm text-cyan-400/80">
                {projectionEngine
                  ? `Engine: ${formatProjectionEngine(projectionEngine)}`
                  : null}
                {aiModel ? ` · ${aiModel}` : ""}
                {generatedLabel ? (
                  <>
                    {" · Generated "}
                    <time dateTime={generatedAt} className="tabular-nums">
                      {generatedLabel}
                    </time>
                  </>
                ) : null}
              </p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <a
              href="#rankings"
              title={headerJumpCtaTitle()}
              aria-label={headerJumpCtaTitle()}
              onClick={(e) => {
                e.preventDefault();
                scrollToRankings({ focusSearch: true });
              }}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition motion-reduce:transition-none hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {headerJumpCtaCopy()}
            </a>
            <div className="flex gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {formatCount(playerCount)}
                </div>
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  {headerPlayersStatLabel()}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center">
                <div className="text-2xl font-bold text-white">{leagueTeams}</div>
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  {headerTeamsStatLabel()}
                </div>
              </div>
            </div>
          </div>
        </div>
        {stale && (
          <HeaderStaleBanner ageDays={ageDays} veryStale={veryStale} />
        )}
        <HeaderRosterNote />
      </div>
    </header>
  );
}
