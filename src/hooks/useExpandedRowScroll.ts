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
 * Also re-scrolls (no focus steal) when the details panel grows after async load.
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

  useEffect(() => {
    if (expandedId == null) return;
    const panel = document.getElementById(`player-panel-${expandedId}`);
    if (!panel) return;

    let lastHeight = panel.getBoundingClientRect().height;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const next = panel.getBoundingClientRect().height;
        if (next <= lastHeight + 1) {
          lastHeight = Math.max(lastHeight, next);
          return;
        }
        lastHeight = next;
        scrollExpandedRowIntoView(expandedId, { focus: false });
      });
    });
    ro.observe(panel);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [expandedId]);
}
