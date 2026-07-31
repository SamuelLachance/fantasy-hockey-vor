"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Position } from "@/lib/types";
import type { SortKey, StatRanges } from "@/lib/rankings-filters";
import {
  nextRankingsUrlSyncAction,
  parseRankingsUrl,
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
    const urlState = parseRankingsUrl(searchParams);
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
    const hash =
      typeof window !== "undefined" && window.location.hash
        ? window.location.hash
        : "";
    router.replace(`${pathname}${action.search ? `?${action.search}` : ""}${hash}`, {
      scroll: false,
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
