"use client";

import { useEffect, useState } from "react";
import { fetchPlayerDetails } from "@/lib/player-details-client";
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
    const ric =
      window.requestIdleCallback ??
      ((cb: IdleRequestCallback) =>
        window.setTimeout(
          () =>
            cb({
              didTimeout: false,
              timeRemaining: () => 0,
            } as IdleDeadline),
          200,
        ));
    const cancel =
      window.cancelIdleCallback ?? ((id: number) => window.clearTimeout(id));
    const id = ric(() => {
      void fetchPlayerDetails()
        .then((d) => {
          setDetailsError(false);
          setDetails(d);
        })
        .catch(() => setDetailsError(true));
    });
    return () => cancel(id as number);
  }, []);

  useEffect(() => {
    if (expandedId == null || details != null || detailsError) return;
    let cancelled = false;
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
  }, [expandedId, details, detailsError]);

  return { details, detailsError, setDetails, setDetailsError };
}
