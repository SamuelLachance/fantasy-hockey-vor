"use client";

import { Search, Snowflake } from "lucide-react";
import { formatCount } from "@/lib/format";

interface HeaderProps {
  season: string;
  playerCount: number;
  projectionEngine?: string;
  aiModel?: string;
}

export function Header({
  season,
  playerCount,
  projectionEngine,
  aiModel,
}: HeaderProps) {
  return (
    <header className="relative overflow-hidden border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
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
              durability, xG and team context — ranked by VOR for your
              head-to-head categories league.
            </p>
            {projectionEngine && (
              <p className="mt-2 text-sm text-cyan-400/80">
                Engine: {projectionEngine.replace(/-/g, " ")}
                {aiModel ? ` · ${aiModel}` : ""}
              </p>
            )}
          </div>
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
              <div className="text-2xl font-bold text-white">12</div>
              <div className="text-xs uppercase tracking-wider text-slate-400">
                Team League
              </div>
            </div>
          </div>
        </div>
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
