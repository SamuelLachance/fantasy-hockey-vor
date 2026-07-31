"use client";

import { useEffect } from "react";
import { scrollToRankings } from "@/lib/board-dom";
import { rankingsHashShouldFocusSearch } from "@/lib/rankings-url";

/** Jump to #rankings on load / hashchange; focus search unless a player is deep-linked. */
export function useRankingsHashJump() {
  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      const focusSearch = rankingsHashShouldFocusSearch(
        new URLSearchParams(window.location.search),
      );
      scrollToRankings({ focusSearch });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);
}
