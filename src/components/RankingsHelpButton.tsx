"use client";

import { CircleHelp } from "lucide-react";

interface RankingsHelpButtonProps {
  onOpenHelp: () => void;
}

/** Toolbar control that opens the board shortcuts dialog (?). */
export function RankingsHelpButton({ onOpenHelp }: RankingsHelpButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpenHelp}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      title="Keyboard shortcuts (?)"
      aria-label="Keyboard shortcuts"
      aria-keyshortcuts="Shift+Slash"
    >
      <CircleHelp className="h-4 w-4" />
    </button>
  );
}
