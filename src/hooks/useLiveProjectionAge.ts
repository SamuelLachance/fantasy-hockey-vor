"use client";

import { useEffect, useState } from "react";
import { projectionAgeDays } from "@/lib/projection-age";

/**
 * SSR/build age for first paint; after mount (and on tab focus) recompute vs
 * wall-clock so static exports can still show a stale banner weeks later.
 */
export function useLiveProjectionAge(
  generatedAt: string | undefined,
  initialAgeDays: number,
): number {
  const [ageDays, setAgeDays] = useState(initialAgeDays);

  useEffect(() => {
    if (!generatedAt) return;
    const refresh = () => {
      setAgeDays(projectionAgeDays(generatedAt, new Date().toISOString()));
    };
    refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") refresh();
    };
    // bfcache restore often skips a visibility flip — pageshow covers it.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [generatedAt]);

  return ageDays;
}
