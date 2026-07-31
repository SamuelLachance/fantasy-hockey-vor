"use client";

import { Download } from "lucide-react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import {
  downloadRankingsCsv,
  downloadRankingsJson,
  exportButtonLabel,
  exportButtonTitle,
  exportGroupAriaLabel,
} from "@/lib/rankings-export";
import { useTimedFlash } from "@/hooks/useTimedFlash";

interface RankingsExportButtonsProps {
  filtered: PlayerProjection[];
  position: Position | "ALL";
  tableCategories: readonly Category[];
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  hideDepthGoalies: boolean;
  statRanges: StatRanges;
}

/** CSV/JSON download group with brief Saved flash. */
export function RankingsExportButtons({
  filtered,
  position,
  tableCategories,
  query,
  sortKey,
  sortDir,
  hideDepthGoalies,
  statRanges,
}: RankingsExportButtonsProps) {
  const [exportFlash, flashExport] = useTimedFlash<"idle" | "csv" | "json">(
    "idle",
  );
  const empty = filtered.length === 0;

  return (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-xl border border-white/10"
      role="group"
      aria-label={exportGroupAriaLabel()}
    >
      <button
        type="button"
        disabled={empty}
        onClick={() => {
          downloadRankingsCsv(filtered, position, tableCategories);
          flashExport("csv");
        }}
        className="inline-flex items-center justify-center gap-2 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
        title={exportButtonTitle("csv")}
        aria-live="polite"
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {exportButtonLabel("csv", exportFlash)}
      </button>
      <button
        type="button"
        disabled={empty}
        onClick={() => {
          downloadRankingsJson(filtered, {
            position,
            categories: tableCategories,
            filters: {
              query,
              sortKey,
              sortDir,
              hideDepthGoalies,
              statRanges,
            },
          });
          flashExport("json");
        }}
        className="inline-flex items-center justify-center border-l border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
        title={exportButtonTitle("json")}
        aria-live="polite"
      >
        {exportButtonLabel("json", exportFlash)}
      </button>
    </div>
  );
}
