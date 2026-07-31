"use client";

import { useEffect } from "react";
import { scrollExpandedRowIntoView } from "@/lib/board-dom";

/** Keep the expanded rankings row in view as the visible window grows. */
export function useExpandedRowScroll(
  expandedId: number | null,
  renderCount: number,
): void {
  useEffect(() => {
    if (expandedId == null) return;
    scrollExpandedRowIntoView(expandedId);
  }, [expandedId, renderCount]);
}
