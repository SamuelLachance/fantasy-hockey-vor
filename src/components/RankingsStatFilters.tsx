"use client";

import { X } from "lucide-react";
import {
  normalizeRangeInput,
  rangeLabel,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";

interface RankingsStatFiltersProps {
  filterRangeKeys: RangeKey[];
  statRanges: StatRanges;
  activeFilterCount: number;
  onUpdateRange: (key: RangeKey, field: "min" | "max", value: string) => void;
  onClear: () => void;
  onDone?: () => void;
}

export function RankingsStatFilters({
  filterRangeKeys,
  statRanges,
  activeFilterCount,
  onUpdateRange,
  onClear,
  onDone,
}: RankingsStatFiltersProps) {
  return (
    <div
      id="rankings-stat-filters"
      className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-white">Filter by stats</h3>
          <p className="text-xs text-slate-500">
            Set min/max for any column. Σσ ≈50 median — lower max = safer
            picks. Save % accepts 91.5, 91.5%, 91,5, or 0.915.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <X className="h-3.5 w-3.5" />
              Clear all
            </button>
          )}
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              aria-keyshortcuts="Enter"
              className="rounded-lg bg-cyan-500/15 px-2.5 py-1 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Done
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filterRangeKeys.map((key) => (
          <div
            key={key}
            className="rounded-xl border border-white/5 bg-white/5 p-3"
          >
            <div className="mb-2 text-xs font-medium text-slate-300">
              {rangeLabel(key)}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="Min"
                aria-label={`${rangeLabel(key)} minimum`}
                value={statRanges[key]?.min ?? ""}
                onChange={(e) => onUpdateRange(key, "min", e.target.value)}
                onBlur={(e) => {
                  const next = normalizeRangeInput(e.target.value);
                  if (next !== e.target.value) onUpdateRange(key, "min", next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onDone?.();
                }}
                className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm tabular-nums text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
              />
              <span className="text-slate-600">–</span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                spellCheck={false}
                placeholder="Max"
                aria-label={`${rangeLabel(key)} maximum`}
                value={statRanges[key]?.max ?? ""}
                onChange={(e) => onUpdateRange(key, "max", e.target.value)}
                onBlur={(e) => {
                  const next = normalizeRangeInput(e.target.value);
                  if (next !== e.target.value) onUpdateRange(key, "max", next);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onDone?.();
                }}
                className="w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-sm tabular-nums text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/25"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
