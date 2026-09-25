"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { Range } from "@/lib/player-table/types";
import { BUTTON_CLASS as BUTTON, FIELD_CLASS as FIELD, LABEL_CLASS as LABEL } from "./PlayerTableToolbar";

/**
 * Form fields every league's filters use (range pairs, selects, toggles,
 * the « Plus de filtres » disclosure), shared so each kind of league only
 * lays out its own filters.
 */

export const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400";

/** `2,5` or `2.5` → 2.5; blank or junk → null. */
export function parseBound(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const showBound = (x: number | null) => (x === null ? "" : String(x).replace(".", ","));

/**
 * Min / max pair. The text is local (so "2," can be typed on the way to
 * "2,5"); a change from outside (reset, preset, Back) replaces it.
 */
export function RangeField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: Range;
  onChange: (r: Range) => void;
  unit?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => ({ min: showBound(value.min), max: showBound(value.max) }));
  const parsed = { min: parseBound(text.min), max: parseBound(text.max) };
  if (parsed.min !== value.min || parsed.max !== value.max) {
    setText({ min: showBound(value.min), max: showBound(value.max) });
  }
  const inverted = value.min !== null && value.max !== null && value.min > value.max;
  const set = (field: "min" | "max", t: string) => {
    const next = { ...text, [field]: t };
    setText(next);
    onChange({ min: parseBound(next.min), max: parseBound(next.max) });
  };
  const input = (field: "min" | "max") => (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      name={`joueurs-${id}-${field}`}
      autoComplete="off"
      data-lpignore="true"
      data-1p-ignore="true"
      spellCheck={false}
      placeholder={field === "min" ? "Min" : "Max"}
      aria-label={`${label} ${field === "min" ? "minimum" : "maximum"}${unit ? ` (${unit})` : ""}`}
      aria-invalid={inverted || undefined}
      aria-describedby={inverted ? `${id}-err` : undefined}
      value={text[field]}
      onChange={(e) => set(field, e.target.value)}
      className={`${FIELD} tabular-nums ${inverted ? "border-rose-400/60" : ""}`}
    />
  );
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
        {unit ? <span className="normal-case tracking-normal text-slate-400"> ({unit})</span> : null}
      </legend>
      <div className="flex items-center gap-2">
        {input("min")}
        <span aria-hidden="true" className="text-slate-600">
          –
        </span>
        {input("max")}
      </div>
      {inverted ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-rose-300">
          Le minimum dépasse le maximum.
        </p>
      ) : null}
    </fieldset>
  );
}

export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={LABEL}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} normal-case tracking-normal`}>
        {children}
      </select>
    </label>
  );
}

export function Toggle({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  /** What exactly the toggle keeps out (tooltip and description). */
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const hintId = useId();
  return (
    <>
      <label
        title={title}
        className={`${CHIP} gap-2 ${
          checked ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100" : "border-white/15 bg-white/5 text-slate-300"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-cyan-400"
        />
        {label}
      </label>
      {/* Outside the label, so it describes the checkbox without lengthening its name. */}
      <span id={hintId} className="sr-only">
        {title}
      </span>
    </>
  );
}

/**
 * « Plus de filtres » / « Moins de filtres » with the count of advanced
 * filters set. Open by default when a bookmarked view carries some; the
 * user's own toggle wins from then on.
 */
export function useMoreFilters(advancedCount: number): { id: string; open: boolean; button: ReactNode } {
  const id = useId();
  const [openState, setOpen] = useState<boolean | null>(null);
  const open = openState ?? advancedCount > 0;
  const button = (
    <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)} className={BUTTON}>
      <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
      {open ? "Moins de filtres" : "Plus de filtres"}
      {advancedCount > 0 ? (
        <span className="rounded-full bg-cyan-500/20 px-1.5 text-xs tabular-nums text-cyan-100">
          {advancedCount}
          <span className="sr-only"> {advancedCount > 1 ? "actifs" : "actif"}</span>
        </span>
      ) : null}
    </button>
  );
  return { id, open, button };
}
