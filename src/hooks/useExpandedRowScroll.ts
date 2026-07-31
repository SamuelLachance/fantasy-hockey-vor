"use client";

import { useEffect, useRef } from "react";
import {
  isBoardSortHeaderFocus,
  scrollExpandedRowIntoView,
} from "@/lib/board-dom";
import type { SortKey } from "@/lib/rankings-filters";

/**
 * Scroll the expanded row (and details panel) into view when expand or sort
 * changes. Intentionally ignores load-more / renderCount so infinite scroll
 * does not yank the page. Sort-header clicks scroll without stealing focus.
 */
export function useExpandedRowScroll(
  expandedId: number | null,
  sortKey: SortKey,
  sortDir: "asc" | "desc",
): void {
  const prevSortRef = useRef({ sortKey, sortDir });

  useEffect(() => {
    if (expandedId == null) {
      prevSortRef.current = { sortKey, sortDir };
      return;
    }
    const sortChanged =
      prevSortRef.current.sortKey !== sortKey ||
      prevSortRef.current.sortDir !== sortDir;
    prevSortRef.current = { sortKey, sortDir };
    const focus = !(sortChanged && isBoardSortHeaderFocus());
    scrollExpandedRowIntoView(expandedId, { focus });
  }, [expandedId, sortKey, sortDir]);
}
