"use client";

import { useEffect, useRef } from "react";
import { scrollToRankings } from "@/lib/board-dom";
import {
  rankingsHashShouldFocusSearch,
  rankingsHashShouldSkipJump,
} from "@/lib/rankings-url";

/**
 * Jump to #rankings on load / hashchange.
 * On-board player deep-links skip the jump (expand-row scroll owns viewport).
 * Filter-hidden but valid ids scroll the board without stealing search focus.
 */
export function useRankingsHashJump(
  filteredPlayers: readonly { id: number }[],
  allPlayers: readonly { id: number }[] = filteredPlayers,
) {
  const filteredRef = useRef(filteredPlayers);
  const allRef = useRef(allPlayers);

  useEffect(() => {
    filteredRef.current = filteredPlayers;
    allRef.current = allPlayers;
  });

  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      const params = new URLSearchParams(window.location.search);
      if (rankingsHashShouldSkipJump(params, filteredRef.current)) return;
      scrollToRankings({
        focusSearch: rankingsHashShouldFocusSearch(
          params,
          filteredRef.current,
          allRef.current,
        ),
      });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);
}
