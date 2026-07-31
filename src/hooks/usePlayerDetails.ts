"use client";

import { useEffect, useRef, useState } from "react";
import { fetchPlayerDetails } from "@/lib/player-details-client";
import { prefersSaveData, scheduleIdle } from "@/lib/schedule-idle";
import type { PlayerDetailRecord } from "@/lib/publish-players";

interface PlayerDetailsState {
  details: Record<string, PlayerDetailRecord> | null;
  detailsError: boolean;
  setDetails: (d: Record<string, PlayerDetailRecord> | null) => void;
  setDetailsError: (v: boolean) => void;
}

/** Idle-prefetch player-details.json; retry on expand if still missing. */
export function usePlayerDetails(expandedId: number | null): PlayerDetailsState {
  const [details, setDetails] = useState<Record<
    string,
    PlayerDetailRecord
  > | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  const expandRequestIdRef = useRef(0);

  useEffect(() => {
    // Skip background prefetch on Save-Data; expand still fetches on demand.
    if (prefersSaveData()) return;
    let cancelled = false;
    const cancelIdle = scheduleIdle(() => {
      void fetchPlayerDetails()
        .then((d) => {
          if (cancelled) return;
          setDetailsError(false);
          setDetails(d);
        })
        .catch(() => {
          // Stay silent on idle failure — expand/retry surfaces the error.
        });
    });
    return () => {
      cancelled = true;
      cancelIdle();
    };
  }, []);

  useEffect(() => {
    // Retry on expand even after a prior failure (detailsError must not block).
    if (expandedId == null || details != null) return;
    const requestId = ++expandRequestIdRef.current;
    queueMicrotask(() => {
      if (expandRequestIdRef.current === requestId) setDetailsError(false);
    });
    fetchPlayerDetails()
      .then((d) => {
        if (expandRequestIdRef.current !== requestId) return;
        setDetailsError(false);
        setDetails(d);
      })
      .catch(() => {
        if (expandRequestIdRef.current !== requestId) return;
        setDetailsError(true);
      });
    return () => {
      // Invalidate so a late settle cannot resurrect error after a newer load.
      if (expandRequestIdRef.current === requestId) {
        expandRequestIdRef.current += 1;
      }
    };
  }, [expandedId, details]);

  return { details, detailsError, setDetails, setDetailsError };
}
