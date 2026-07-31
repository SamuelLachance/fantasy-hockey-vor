"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import {
  nextRankingsUrlSyncAction,
  parseLiveRankingsUrl,
  rankingsUrlSearch,
  rankingsUrlSyncHref,
  type RankingsUrlState,
} from "@/lib/rankings-url";

interface RankingsUrlSyncInput {
  position: Position | "ALL";
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  expandedId: number | null;
  hideDepthGoalies: boolean;
  statRanges: StatRanges;
  onHydrate: (state: RankingsUrlState) => void;
}

/**
 * Write the board query into the address bar without App Router navigation.
 * Uses the native History API (not Next's patched replaceState) so we do not
 * dispatch ACTION_RESTORE / soft-navigate — those still scroll-to-top on
 * static export even with scroll:false, and left renderedSearch stale when
 * driven via the patched replaceState(null) path.
 *
 * Omits `#rankings` so query sync never re-triggers hash scrolling.
 * Board hydration on Back/Forward uses popstate + location.search.
 */
function replaceBoardUrl(pathname: string, search: string): void {
  const href = rankingsUrlSyncHref(pathname, search, "");
  const state = window.history.state;
  History.prototype.replaceState.call(window.history, state, "", href);
}

/** Keep board filters and the address bar in sync (including Back/Forward). */
export function useRankingsUrlSync({
  position,
  query,
  sortKey,
  sortDir,
  expandedId,
  hideDepthGoalies,
  statRanges,
  onHydrate,
}: RankingsUrlSyncInput): void {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const lastPushedRef = useRef<string | null>(null);
  const onHydrateRef = useRef(onHydrate);

  useEffect(() => {
    onHydrateRef.current = onHydrate;
  }, [onHydrate]);

  // Back/Forward / in-page history: prefer live location over React searchParams
  // (we intentionally bypass Next's history patch on board sync writes).
  useEffect(() => {
    function onPopState() {
      const urlState = parseLiveRankingsUrl(
        { toString: () => "" },
        window.location.search,
      );
      const urlSearch = rankingsUrlSearch(urlState);
      if (urlSearch === lastPushedRef.current) return;
      lastPushedRef.current = urlSearch;
      onHydrateRef.current(urlState);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const stateSearch = rankingsUrlSearch({
      position,
      query,
      sortKey,
      sortDir,
      playerId: expandedId,
      hideDepthGoalies,
      statRanges,
    });
    // Prefer location.search — Next searchParams will not track native replaces.
    const urlState = parseLiveRankingsUrl(
      searchParams,
      typeof window !== "undefined" ? window.location.search : null,
    );
    const urlSearch = rankingsUrlSearch(urlState);
    const action = nextRankingsUrlSyncAction(
      lastPushedRef.current,
      urlSearch,
      stateSearch,
    );

    if (action.type === "noop") {
      lastPushedRef.current = action.search;
      return;
    }

    if (action.type === "hydrate") {
      lastPushedRef.current = action.search;
      onHydrateRef.current(urlState);
      return;
    }

    lastPushedRef.current = action.search;
    replaceBoardUrl(pathname, action.search);
  }, [
    position,
    query,
    sortKey,
    sortDir,
    expandedId,
    hideDepthGoalies,
    statRanges,
    pathname,
    searchParams,
  ]);
}
