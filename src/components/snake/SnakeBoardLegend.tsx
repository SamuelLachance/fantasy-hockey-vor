"use client";

import { useSnakeBoardStatus } from "@/lib/snake/board-store";
import { SnakeDisclaimerShort } from "./SnakeDisclaimer";

/**
 * What the "S++ … S−−" chips on the rankings board are, and the Snake
 * disclaimer, under the table once the chips have loaded (they arrive when
 * the browser is idle; nothing here is in the prerendered HTML, and sitting
 * below the rows it never shifts them).
 */
export function SnakeBoardLegend() {
  const status = useSnakeBoardStatus();
  if (status !== "ready") return null;
  return (
    <div className="space-y-1.5 border-t border-white/10 px-4 py-3">
      <p className="text-xs text-slate-400">
        <span className="font-semibold text-slate-300">S++ … S−− chips:</span> Simon “Snake” Boisvert&apos;s verdict
        on the player (very positive to very negative), summarized in French from his public podcasts;{" "}
        <span className="font-mono">?</span> = attribution only probable. Open a player for the details and sources.
      </p>
      <SnakeDisclaimerShort />
    </div>
  );
}
