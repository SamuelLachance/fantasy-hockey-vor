"use client";

import { useEffect, useRef } from "react";
import { scrollToRankings } from "@/lib/board-dom";
import { rankingsHashShouldFocusSearch } from "@/lib/rankings-url";

/**
 * Jump to #rankings on load / hashchange and focus search — unless a player
 * deep-link is still on the filtered board (expand-row scroll owns the viewport).
 * Coerced-away player ids fall back to board scroll + search focus.
 */
export function useRankingsHashJump(
  filteredPlayers: readonly { id: number }[],
) {
  const filteredRef = useRef(filteredPlayers);

  useEffect(() => {
    filteredRef.current = filteredPlayers;
  });

  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      const params = new URLSearchParams(window.location.search);
      if (!rankingsHashShouldFocusSearch(params, filteredRef.current)) return;
      scrollToRankings({ focusSearch: true });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);
}
