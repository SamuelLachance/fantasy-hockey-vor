"use client";

import { useEffect } from "react";
import { scrollExpandedRowIntoView } from "@/lib/board-dom";

/**
 * Scroll the expanded row (and details panel) into view when expand changes.
 * Intentionally ignores load-more / renderCount so infinite scroll does not yank the page.
 */
export function useExpandedRowScroll(expandedId: number | null): void {
  useEffect(() => {
    if (expandedId == null) return;
    scrollExpandedRowIntoView(expandedId);
  }, [expandedId]);
}
