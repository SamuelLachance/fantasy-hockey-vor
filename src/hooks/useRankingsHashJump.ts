"use client";

import { useEffect } from "react";
import { scrollToRankings } from "@/lib/board-dom";

/** Jump to #rankings and focus search on load / hashchange. */
export function useRankingsHashJump() {
  useEffect(() => {
    function jumpIfRankingsHash() {
      if (window.location.hash !== "#rankings") return;
      scrollToRankings({ focusSearch: true });
    }
    jumpIfRankingsHash();
    window.addEventListener("hashchange", jumpIfRankingsHash);
    return () => window.removeEventListener("hashchange", jumpIfRankingsHash);
  }, []);
}
