"use client";

import { startTransition } from "react";
import { GOALIE_DEPTH_MAX_GP } from "@/lib/goalie-depth";

interface RankingsGoalieDepthToggleProps {
  hideDepthGoalies: boolean;
  setHideDepthGoalies: (v: boolean | ((prev: boolean) => boolean)) => void;
}

/** Starters / All G toolbar control (Shift+G). */
export function RankingsGoalieDepthToggle({
  hideDepthGoalies,
  setHideDepthGoalies,
}: RankingsGoalieDepthToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={hideDepthGoalies}
      onClick={() => startTransition(() => setHideDepthGoalies((v) => !v))}
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border px-4 py-2.5 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 ${
        hideDepthGoalies
          ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-200"
          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
      }`}
      title={`Hide org-depth goalies at 4–${GOALIE_DEPTH_MAX_GP} GP (Shift+G)`}
      aria-keyshortcuts="Shift+G"
    >
      {hideDepthGoalies ? "Starters" : "All G"}
    </button>
  );
}
