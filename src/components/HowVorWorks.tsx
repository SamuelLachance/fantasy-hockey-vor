import type { LeagueSettings } from "@/lib/types";
import type { CategoryDifficultyWeights } from "@/lib/stat-difficulty";
import { CATEGORY_FULL_LABELS } from "@/lib/format";
import {
  howVorReplacementCopy,
  howVorScarcityHintCopy,
  howVorYahooPositionsCopy,
  howVorZScoreCopy,
} from "@/lib/how-vor-copy";
import { GOALIE_CATEGORIES, SKATER_CATEGORIES } from "@/lib/types";
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
    <section
      aria-labelledby="how-vor-works-title"
      className="[content-visibility:auto] [contain-intrinsic-size:auto_22rem] rounded-2xl border border-white/10 bg-gradient-to-br from-cyan-950/30 to-slate-950/80 p-6 lg:col-span-2 xl:col-span-3"
    >
      <div className="mb-4 flex items-center gap-2 text-emerald-400">
        <Shield className="h-5 w-5" />
        <h2
          id="how-vor-works-title"
          className="text-lg font-semibold text-white"
        >
          How VOR Works
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-white/5 p-4">
          <Zap className="mb-2 h-5 w-5 text-cyan-400" />
          <h3 className="font-medium text-white">Category Z-Scores</h3>
          <p className="mt-1 text-sm text-slate-400">{howVorZScoreCopy()}</p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 p-4">
          <Target className="mb-2 h-5 w-5 text-cyan-400" />
          <h3 className="font-medium text-white">Replacement Level</h3>
          <p className="mt-1 text-sm text-slate-400">
            {howVorReplacementCopy(teams, league.roster)}
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-white/5 p-4">
          <Trophy className="mb-2 h-5 w-5 text-cyan-400" />
          <h3 className="font-medium text-white">Yahoo Positions</h3>
          <p className="mt-1 text-sm text-slate-400">
            {howVorYahooPositionsCopy()}
          </p>
        </div>
      </div>
      {categoryWeights && (
        <div className="mt-6 rounded-xl border border-white/5 bg-white/5 p-4">
          <h3 className="mb-3 text-sm font-medium text-white">
            Category scarcity weights (skaters)
          </h3>
          <p className="mb-3 text-xs text-slate-400">
            {howVorScarcityHintCopy()}
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
    </section>
  );
}
