import type { LeagueSettings } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import { CATEGORY_FULL_LABELS } from "@/lib/format";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "@/lib/types";
import { replacementRank } from "@/lib/league";
import { Trophy, Target, Shield, Zap } from "lucide-react";

interface HowVorWorksProps {
  teams: number;
  league: LeagueSettings;
  categoryWeights?: CategoryDifficultyWeights;
}

/** Explainer + scarcity weight chips under TopPlayers leaders. */
export function HowVorWorks({
  teams,
  league,
  categoryWeights,
}: HowVorWorksProps) {
  return (
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
            Higher weight = harder to generate vs replacement; counts more toward
            VOR.
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
  );
}
