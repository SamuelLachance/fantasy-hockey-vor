"use client";

import { useEffect } from "react";
import type { Position } from "@/lib/types";
import { boardDocumentTitle } from "@/lib/board-document-title";
import type { SortKey } from "@/lib/rankings-filters";
import { siteDefaultTitle } from "@/lib/site-meta";

/** Keep the browser tab title in sync with board filters / sort / expanded player. */
export function useBoardDocumentTitle(opts: {
  position: Position | "ALL";
  query: string;
  playerName?: string | null;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  activeFilterCount?: number;
  showingAllGoalies?: boolean;
}): void {
  const {
    position,
    query,
    playerName,
    sortKey,
    sortDir,
    activeFilterCount = 0,
    showingAllGoalies = false,
  } = opts;
  useEffect(() => {
    document.title = boardDocumentTitle({
      position,
      query,
      playerName,
      sortKey,
      sortDir,
      activeFilterCount,
      showingAllGoalies,
    });
  }, [
    position,
    query,
    playerName,
    sortKey,
    sortDir,
    activeFilterCount,
    showingAllGoalies,
  ]);

  useEffect(() => {
    return () => {
      document.title = siteDefaultTitle();
    };
  }, []);
}
