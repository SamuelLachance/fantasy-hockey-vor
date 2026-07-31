"use client";

import { X } from "lucide-react";
import { focusFirstStatFilterInput } from "@/lib/board-dom";
import {
  isInvertedRangeBound,
  normalizeRangeInput,
  rangeLabel,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import {
  clearAllStatFiltersCopy,
  doneStatFiltersCopy,
  statFiltersHintCopy,
  statFiltersPanelTitle,
} from "@/lib/stat-filters-copy";

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
      role="region"
      aria-labelledby="rankings-stat-filters-title"
      aria-describedby="rankings-stat-filters-hint"
      className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 shadow-lg"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h3
            id="rankings-stat-filters-title"
            className="text-sm font-semibold text-white"
          >
            {statFiltersPanelTitle()}
          </h3>
          <p
            id="rankings-stat-filters-hint"
            className="text-xs text-slate-500"
          >
            {statFiltersHintCopy()}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={() => {
                onClear();
                queueMicrotask(focusFirstStatFilterInput);
              }}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <X className="h-3.5 w-3.5" />
              {clearAllStatFiltersCopy()}
            </button>
          )}
          {onDone && (
            <button
              type="button"
              onClick={onDone}
              aria-keyshortcuts="Enter"
              className="inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              {doneStatFiltersCopy()}
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filterRangeKeys.map((key) => {
          const bounds = statRanges[key];
          const inverted = isInvertedRangeBound(
            key,
            bounds?.min,
            bounds?.max,
          );
          const errorId = `range-error-${key}`;
          const inputClass = inverted
            ? "w-full rounded-lg border border-rose-500/50 bg-slate-950/60 px-2 py-1.5 text-base tabular-nums text-white placeholder:text-slate-600 focus:border-rose-400/60 focus:outline-none focus:ring-2 focus:ring-rose-500/30"
            : "w-full rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-base tabular-nums text-white placeholder:text-slate-600 focus:border-cyan-500/40 focus:outline-none focus:ring-2 focus:ring-cyan-500/25";
          return (
            <div
              key={key}
              className={`rounded-xl border bg-white/5 p-3 ${
                inverted ? "border-rose-500/40" : "border-white/5"
              }`}
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
                  aria-invalid={inverted || undefined}
                  aria-describedby={inverted ? errorId : undefined}
                  value={bounds?.min ?? ""}
                  onChange={(e) => onUpdateRange(key, "min", e.target.value)}
                  onBlur={(e) => {
                    const next = normalizeRangeInput(e.target.value);
                    if (next !== e.target.value) onUpdateRange(key, "min", next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onDone?.();
                  }}
                  className={inputClass}
                />
                <span className="text-slate-600">–</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Max"
                  aria-label={`${rangeLabel(key)} maximum`}
                  aria-invalid={inverted || undefined}
                  aria-describedby={inverted ? errorId : undefined}
                  value={bounds?.max ?? ""}
                  onChange={(e) => onUpdateRange(key, "max", e.target.value)}
                  onBlur={(e) => {
                    const next = normalizeRangeInput(e.target.value);
                    if (next !== e.target.value) onUpdateRange(key, "max", next);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onDone?.();
                  }}
                  className={inputClass}
                />
              </div>
              {inverted && (
                <p
                  id={errorId}
                  role="alert"
                  className="mt-1.5 text-[11px] text-rose-300/90"
                >
                  Min is greater than max
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
