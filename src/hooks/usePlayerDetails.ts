"use client";

import { useEffect, useState } from "react";
import { fetchPlayerDetails } from "@/lib/player-details-client";
import { scheduleIdle } from "@/lib/schedule-idle";
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

  useEffect(() => {
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
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDetailsError(false);
    });
    fetchPlayerDetails()
      .then((d) => {
        if (!cancelled) {
          setDetailsError(false);
          setDetails(d);
        }
      })
      .catch(() => {
        if (!cancelled) setDetailsError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [expandedId, details]);

  return { details, detailsError, setDetails, setDetailsError };
}
