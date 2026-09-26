"use client";

import { DYNASTY_MODE_HINT, DYNASTY_MODE_LABEL, DYNASTY_MODE_SHORT, DYNASTY_MODES } from "@/lib/fantrax/dynasty-mode";
import { useFantraxLeague } from "./fantrax-league-context";

/**
 * « Gagner maintenant · Équilibré · Long terme »: the horizon of the dynasty
 * value on every Captains tab (tables, filters, sorts, Mon équipe). Native
 * radios in a fieldset (arrow keys move between them), one segmented row
 * of 44 px targets at every width (shorter words on a phone); the choice
 * goes in the address (`?mode=`) and follows the tab links.
 */
export function DynastyModeSwitch({ idPrefix, className = "" }: { idPrefix: string; className?: string }) {
  const { mode, chooseMode } = useFantraxLeague();
  const hintId = `${idPrefix}-mode-aide`;
  return (
    <fieldset className={`min-w-0 ${className}`.trim()} aria-describedby={hintId}>
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Horizon de la valeur dynastie</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/15 bg-slate-900 p-1 sm:inline-grid">
        {DYNASTY_MODES.map((m) => (
          <label
            key={m}
            className={`flex min-h-11 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm leading-tight transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400 sm:px-3 ${
              mode === m ? "bg-cyan-500/20 font-semibold text-cyan-100" : "text-slate-300 hover:text-white"
            }`}
          >
            <input
              type="radio"
              name={`${idPrefix}-mode`}
              value={m}
              checked={mode === m}
              onChange={() => chooseMode(m)}
              className="sr-only"
            />
            <span className="sm:hidden">{DYNASTY_MODE_SHORT[m]}</span>
            <span className="hidden whitespace-nowrap sm:inline">{DYNASTY_MODE_LABEL[m]}</span>
          </label>
        ))}
      </div>
      <p id={hintId} className="mt-1 text-xs text-slate-400">
        {DYNASTY_MODE_HINT[mode]}
      </p>
    </fieldset>
  );
}
