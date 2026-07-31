"use client";

import { useEffect } from "react";
import { scrollToRankings } from "@/lib/board-dom";
import { rankingsHashShouldFocusSearch } from "@/lib/rankings-url";

/**
 * Jump to #rankings on load / hashchange and focus search — unless a player
 * deep-link is present (expand-row scroll owns the viewport).
 */
export function useRankingsHashJump() {
  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      const params = new URLSearchParams(window.location.search);
      // ?player=…#rankings: skip board-top scroll so expanded-row scroll wins.
      if (!rankingsHashShouldFocusSearch(params)) return;
      scrollToRankings({ focusSearch: true });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);
}
