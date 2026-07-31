"use client";

import { useEffect, useRef } from "react";

interface BoardShortcutsHelpProps {
  open: boolean;
  onClose: () => void;
}

const ROWS: Array<{ keys: string; action: string }> = [
  { keys: "/", action: "Focus search" },
  { keys: "f", action: "Toggle stat filters" },
  { keys: "v / e / u / g", action: "Sort by VOR / Edge / Σσ / GP" },
  { keys: "?", action: "Toggle this help" },
  { keys: "Esc", action: "Close help / filters / row" },
  { keys: "j / ↓", action: "Next expanded player" },
  { keys: "k / ↑", action: "Previous expanded player" },
  { keys: "Double-click header", action: "Reset sort to VOR" },
];

export function BoardShortcutsHelp({ open, onClose }: BoardShortcutsHelpProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function onTab(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = document.getElementById("board-shortcuts-dialog");
      if (!root) return;
      const focusable = [
        ...root.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter((el) => !el.hasAttribute("disabled"));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onTab);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onTab);
    };
  }, [open]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-shortcuts-title"
      onClick={onClose}
    >
      <div
        id="board-shortcuts-dialog"
        className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2
            id="board-shortcuts-title"
            className="text-lg font-semibold text-white"
          >
            Board shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          >
            Esc
          </button>
        </div>
        <ul className="space-y-2 text-sm">
          {ROWS.map((row) => (
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
    </div>
  );
}
