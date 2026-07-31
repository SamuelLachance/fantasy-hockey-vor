"use client";

import { useEffect, useRef } from "react";
import { focusBoardSearch } from "@/lib/board-dom";

/**
 * When filters/data drop the expanded player (row unmounts), recover focus into
 * the board instead of dumping onto document.body. Manual collapse leaves the
 * row in the DOM so this no-ops.
 */
export function useCoercedExpandFocusRestore(
  expandedId: number | null,
): void {
  const lastExpandedRef = useRef<number | null>(expandedId);

  useEffect(() => {
    if (expandedId != null) {
      lastExpandedRef.current = expandedId;
      return;
    }
    const prev = lastExpandedRef.current;
    lastExpandedRef.current = null;
    if (prev == null) return;
    // Still mounted → intentional collapse / Esc; leave focus alone.
    if (document.getElementById(`player-row-${prev}`)) return;

    const firstRow = document.querySelector<HTMLElement>(
      '#rankings-board-table tbody tr[id^="player-row-"]',
    );
    if (firstRow) {
      firstRow.focus({ preventScroll: true });
      return;
    }
    focusBoardSearch();
  }, [expandedId]);
}
