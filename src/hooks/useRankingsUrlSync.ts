"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import { withPinnedWindowScroll } from "@/lib/board-dom";
import {
  nextRankingsUrlSyncAction,
  parseLiveRankingsUrl,
  rankingsBoardRouterHref,
  rankingsUrlSearch,
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
  const router = useRouter();
  const pathname = usePathname();
  const lastPushedRef = useRef<string | null>(null);
  const onHydrateRef = useRef(onHydrate);

  useEffect(() => {
    onHydrateRef.current = onHydrate;
  }, [onHydrate]);

  // Back/Forward: hydrate from the live address bar even if searchParams lag.
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
    const urlState = parseLiveRankingsUrl(searchParams);
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
    // Query-only sync must not re-attach #rankings (hash scrolling) and must
    // keep App Router searchParams/history coherent. `history.replaceState`
    // left Next's renderedSearch stale and broke subsequent navigations;
    // `router.replace(..., { scroll: false })` still jumps scroll on static
    // export — pin scrollY across the replace.
    const href = rankingsBoardRouterHref(pathname, action.search);
    withPinnedWindowScroll(() => {
      router.replace(href, { scroll: false });
    });
  }, [
    position,
    query,
    sortKey,
    sortDir,
    expandedId,
    hideDepthGoalies,
    statRanges,
    pathname,
    router,
    searchParams,
  ]);
}
