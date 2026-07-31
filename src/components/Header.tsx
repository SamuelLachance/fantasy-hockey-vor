"use client";

import { Search, Snowflake } from "lucide-react";
import { formatCount } from "@/lib/format";

interface HeaderProps {
  season: string;
  playerCount: number;
  leagueTeams?: number;
  generatedAt?: string;
  /** Precomputed age in days (from server) — avoids impure Date.now in render. */
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
  const ageDays = projectionAgeDays;
  const stale = ageDays > 21;
  const veryStale = ageDays > 45;
  return (
    <header className="relative overflow-hidden border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
      <a
        href="#rankings"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-cyan-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
      >
        Skip to rankings
      </a>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(56,189,248,0.15),_transparent_55%)]" />
      <div className="pointer-events-none absolute -right-20 top-0 h-64 w-64 rounded-full bg-cyan-500/10 blur-3xl" />
      <div className="relative mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 text-cyan-400">
          <Snowflake className="h-5 w-5" />
          <span className="text-sm font-medium uppercase tracking-[0.2em]">
            Value Over Replacement
          </span>
        </div>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Fantasy Hockey Rankings
            </h1>
            <p className="mt-3 max-w-2xl text-lg text-slate-400">
              {season} projections from a stacked ML ensemble — gradient
              boosting, ridge and Marcel models blended per stat, with game-log
              durability, xG and team context — ranked by VOR. Edge is consensus
              rank minus model rank (undervalued when positive); expand a row
              for per-stat ±1σ uncertainty.
            </p>
            {(projectionEngine || generatedLabel) && (
              <p className="mt-2 text-sm text-cyan-400/80">
                {projectionEngine
                  ? `Engine: ${projectionEngine.replace(/-/g, " ")}`
                  : null}
                {aiModel ? ` · ${aiModel}` : ""}
                {generatedLabel ? (
                  <>
                    {" · Generated "}
                    <time dateTime={generatedAt}>{generatedLabel}</time>
                  </>
                ) : null}
              </p>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-3 sm:items-end">
            <a
              href="#rankings"
              className="inline-flex items-center justify-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-200 transition hover:border-cyan-400/60 hover:bg-cyan-500/20 hover:text-white focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              Jump to board
            </a>
            <div className="flex gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {formatCount(playerCount)}
                </div>
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  Players
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-center">
                <div className="text-2xl font-bold text-white">{leagueTeams}</div>
                <div className="text-xs uppercase tracking-wider text-slate-400">
                  Team League
                </div>
              </div>
            </div>
          </div>
        </div>
        {stale && (
          <div
            role="status"
            className={`rounded-xl px-4 py-3 text-sm ${
              veryStale
                ? "border border-rose-500/40 bg-rose-500/10 text-rose-100/90"
                : "border border-amber-500/30 bg-amber-500/10 text-amber-100/90"
            }`}
          >
            Rankings data is {Math.floor(ageDays)} days old
            {veryStale ? " (refresh urgently)" : ""} — re-run{" "}
            <code className={veryStale ? "text-rose-200" : "text-amber-200"}>
              npm run generate
            </code>{" "}
            after refresh/train for current projections.
          </div>
        )}
        <div className="flex items-start gap-2 rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 text-sm text-cyan-100/90">
          <Search className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
          <p>
            Roster: 2C · 2LW · 2RW · 4D · 2G daily. Skater cats: G, A, SOG,
            BLK, HIT, PPP, PIM, FOW. Goalie cats: W, SO, SV, SV%.
          </p>
        </div>
      </div>
    </header>
  );
}
