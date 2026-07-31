"use client";

import { createPortal } from "react-dom";
import {
  boardShortcutsCloseAriaLabel,
  boardShortcutsDialogTitle,
  boardShortcutsEscLabel,
} from "@/lib/board-help-copy";
import {
  BOARD_SHORTCUT_ROWS,
  BOARD_SHORTCUTS_DIALOG_ID,
} from "@/lib/board-shortcuts";
import { useDialogFocusTrap } from "@/hooks/useDialogFocusTrap";

interface BoardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

export function BoardShortcutsHelp({ open, onClose }: BoardShortcutsHelpProps) {
  useDialogFocusTrap(open, BOARD_SHORTCUTS_DIALOG_ID, onClose);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-dialog-portal={BOARD_SHORTCUTS_DIALOG_ID}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-sm motion-reduce:backdrop-blur-none pt-[max(1rem,env(safe-area-inset-top,0px))] pr-[max(1rem,env(safe-area-inset-right,0px))] pb-[max(1rem,env(safe-area-inset-bottom,0px))] pl-[max(1rem,env(safe-area-inset-left,0px))]"
      onClick={onClose}
    >
      <div
        id={BOARD_SHORTCUTS_DIALOG_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby="board-shortcuts-title"
        aria-describedby="board-shortcuts-list"
        tabIndex={-1}
        className="max-h-[min(85dvh,calc(100dvh-2rem))] w-full max-w-md overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="board-shortcuts-title"
            className="text-lg font-semibold text-white"
          >
            {boardShortcutsDialogTitle()}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={boardShortcutsCloseAriaLabel()}
            aria-keyshortcuts="Escape"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            {boardShortcutsEscLabel()}
          </button>
        </div>
        <ul id="board-shortcuts-list" className="space-y-2 text-sm">
          {BOARD_SHORTCUT_ROWS.map((row) => (
            <li
              key={row.keys}
              className="flex items-center justify-between gap-4 border-b border-white/5 pb-2 last:border-0"
            >
              <kbd className="rounded-md border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-xs text-cyan-200">
                {row.keys}
              </kbd>
              <span className="text-slate-300">{row.action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
