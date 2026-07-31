"use client";

import { X } from "lucide-react";
import {
  formatRangeChip,
  rangeLabel,
  type RangeKey,
  type StatRanges,
} from "@/lib/rankings-filters";

interface ActiveStatFilterChipsProps {
  statRanges: StatRanges;
  onOpen: () => void;
  onClear: () => void;
  onRemove: (key: RangeKey) => void;
}

export function ActiveStatFilterChips({
  statRanges,
  onOpen,
  onClear,
  onRemove,
}: ActiveStatFilterChipsProps) {
  const chips = (
    Object.entries(statRanges) as Array<
      [RangeKey, { min: string; max: string } | undefined]
    >
  ).filter(([, b]) => b && (b.min.trim() !== "" || b.max.trim() !== ""));

  if (chips.length === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      aria-label="Active stat filters"
    >
      {chips.map(([key, bound]) => {
        const text = formatRangeChip(bound!.min, bound!.max);
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-full border border-cyan-500/30 bg-cyan-500/10 pl-2.5 text-xs text-cyan-100"
          >
            <button
              type="button"
              onClick={onOpen}
              className="py-1 pr-0.5 font-medium transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
              title="Edit filters"
            >
              {rangeLabel(key)} {text}
            </button>
            <button
              type="button"
              aria-label={`Remove ${rangeLabel(key)} filter`}
              onClick={() => onRemove(key)}
              className="rounded-full p-1 text-cyan-300/80 transition hover:bg-cyan-500/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      <button
        type="button"
        onClick={onClear}
        className="rounded-full px-2 py-1 text-xs text-slate-400 transition hover:bg-white/5 hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
      >
        Clear filters
      </button>
    </div>
  );
}
