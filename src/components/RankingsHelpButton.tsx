"use client";

import { CircleHelp } from "lucide-react";
import {
  boardHelpAriaLabel,
  boardHelpButtonGlyph,
  boardHelpTitle,
} from "@/lib/board-help-copy";
import { BOARD_SHORTCUTS_DIALOG_ID } from "@/lib/board-shortcuts";

interface RankingsHelpButtonProps {
  helpOpen: boolean;
  onOpenHelp: () => void;
}

/** Toolbar control that opens the board shortcuts dialog (?). */
export function RankingsHelpButton({
  helpOpen,
  onOpenHelp,
}: RankingsHelpButtonProps) {
  return (
    <button
      type="button"
      onClick={onOpenHelp}
      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
      title={boardHelpTitle()}
      aria-label={boardHelpAriaLabel()}
      aria-keyshortcuts="Shift+Slash"
      aria-haspopup="dialog"
      aria-expanded={helpOpen}
      aria-controls={helpOpen ? BOARD_SHORTCUTS_DIALOG_ID : undefined}
    >
      <CircleHelp className="h-4 w-4" aria-hidden="true" />
      <span aria-hidden="true" className="font-mono text-xs">
        {boardHelpButtonGlyph()}
      </span>
    </button>
  );
}
