"use client";

import { useCallback, useEffect, useState } from "react";
import type { TableStatus } from "@/components/player-table/adapter";
import type { LeaguePool } from "@/lib/draft/board-types";
import { loadLeaguePool, peekLeaguePool } from "@/lib/draft/league-pool-client";

export interface LeaguePoolState {
  pool: LeaguePool | null;
  status: TableStatus;
  /** Start loading (idempotent). */
  want(): void;
  retry(): void;
}

/**
 * The league's `pool.json` (every player past the inlined board): loaded
 * at once with `autoLoad`, else on `want()`; kept for the page view.
 */
export function useLeaguePool(slug: string, autoLoad: boolean): LeaguePoolState {
  const [wanted, setWanted] = useState(autoLoad);
  const [pool, setPool] = useState<LeaguePool | null>(() => peekLeaguePool(slug));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!wanted || pool) return;
    let cancelled = false;
    loadLeaguePool(slug).then(
      (p) => {
        if (cancelled) return;
        setPool(p);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [slug, wanted, attempt, pool]);

  const want = useCallback(() => setWanted(true), []);
  const retry = useCallback(() => {
    setFailed(false);
    setWanted(true);
    setAttempt((n) => n + 1);
  }, []);
  const status: TableStatus = pool ? "ready" : failed ? "error" : wanted ? "loading" : "idle";
  return { pool, status, want, retry };
}
