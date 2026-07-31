"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Position } from "@/lib/types";
import type { SortKey } from "@/lib/rankings-filters";
import { parseRankingsUrl, rankingsUrlSearch } from "@/lib/rankings-url";

interface RankingsUrlSyncInput {
  position: Position | "ALL";
  deferredQuery: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  expandedId: number | null;
  hideDepthGoalies: boolean;
}

/** Keep the address bar in sync with board filters without scrolling. */
export function useRankingsUrlSync({
  position,
  deferredQuery,
  sortKey,
  sortDir,
  expandedId,
  hideDepthGoalies,
}: RankingsUrlSyncInput): void {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const next = rankingsUrlSearch({
      position,
      query: deferredQuery,
      sortKey,
      sortDir,
      playerId: expandedId,
      hideDepthGoalies,
    });
    const current = rankingsUrlSearch(parseRankingsUrl(searchParams));
    if (next === current) return;
    const hash =
      typeof window !== "undefined" && window.location.hash
        ? window.location.hash
        : "";
    router.replace(`${pathname}${next ? `?${next}` : ""}${hash}`, {
      scroll: false,
    });
  }, [
    position,
    deferredQuery,
    sortKey,
    sortDir,
    expandedId,
    hideDepthGoalies,
    pathname,
    router,
    searchParams,
  ]);
}
