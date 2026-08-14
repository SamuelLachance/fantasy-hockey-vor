"use client";

import { Download } from "lucide-react";
import type { Category, PlayerProjection, Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import {
  downloadRankingsCsv,
  downloadRankingsJson,
  exportButtonAriaLabel,
  exportButtonLabel,
  exportButtonTitle,
  exportGroupAriaLabel,
  exportSavedLiveCopy,
  type RankingsExportContext,
} from "@/lib/rankings-export";
import { useTimedFlash } from "@/hooks/useTimedFlash";

interface RankingsExportButtonsProps {
  filtered: PlayerProjection[];
  position: Position | "ALL";
  tableCategories: readonly Category[];
  /** Settled search string that produced `filtered` (deferredQuery). */
  query: string;
  /** True while live query is ahead of deferred filtering. */
  searchPending?: boolean;
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
  searchPending = false,
  sortKey,
  sortDir,
  hideDepthGoalies,
  statRanges,
}: RankingsExportButtonsProps) {
  const [exportFlash, flashExport] = useTimedFlash<"idle" | "csv" | "json">(
    "idle",
  );
  const empty = filtered.length === 0;
  const blocked = empty || searchPending;
  const csvTitle = exportButtonTitle("csv", { searchPending, empty });
  const jsonTitle = exportButtonTitle("json", { searchPending, empty });
  const csvAria = exportButtonAriaLabel("csv", {
    searchPending,
    empty,
  });
  const jsonAria = exportButtonAriaLabel("json", {
    searchPending,
    empty,
  });
  const ctx: RankingsExportContext = {
    position,
    categories: tableCategories,
    filters: {
      query,
      sortKey,
      sortDir,
      hideDepthGoalies,
      statRanges,
    },
  };
  const savedLive = exportSavedLiveCopy(exportFlash);

  return (
    <div
      className="inline-flex shrink-0 overflow-hidden rounded-xl border border-white/10"
      role="group"
      aria-label={exportGroupAriaLabel()}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {savedLive}
      </span>
      <button
        type="button"
        disabled={blocked}
        onClick={() => {
          downloadRankingsCsv(filtered, ctx);
          flashExport("csv");
        }}
        className="inline-flex min-h-11 items-center justify-center gap-2 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
        title={csvTitle}
        aria-label={csvAria}
      >
        <Download className="h-4 w-4" aria-hidden="true" />
        {exportButtonLabel("csv", exportFlash)}
      </button>
      <button
        type="button"
        disabled={blocked}
        onClick={() => {
          downloadRankingsJson(filtered, ctx);
          flashExport("json");
        }}
        className="inline-flex min-h-11 items-center justify-center border-l border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-not-allowed disabled:opacity-40"
        title={jsonTitle}
        aria-label={jsonAria}
      >
        {exportButtonLabel("json", exportFlash)}
      </button>
    </div>
  );
}
