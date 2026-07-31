"use client";

import { useEffect, useRef, useState } from "react";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import { focusPlayerRow } from "@/lib/board-dom";
import { fetchPlayerDetails } from "@/lib/player-details-client";
import {
  playerNotesLoadingLabel,
  playerNotesRetryLabel,
  playerNotesUnavailableCopy,
} from "@/lib/player-notes-copy";

interface ExpandedPlayerNotesProps {
  playerId: number;
  playerDetails: PlayerDetailRecord | undefined;
  detailsLoading: boolean;
  detailsError: boolean;
  onDetailsLoaded: (details: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
}

/** Reasoning / profile / loading / retry for the expanded player panel. */
export function ExpandedPlayerNotes({
  playerId,
  playerDetails,
  detailsLoading,
  detailsError,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
}: ExpandedPlayerNotesProps) {
  const [retrying, setRetrying] = useState(false);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  function retryDetails() {
    if (retrying) return;
    setRetrying(true);
    // Join any in-flight expand fetch — do not reset the cache (orphans its reject).
    // Keep the alert/Retry mounted until the fetch settles (do not clear error yet).
    void fetchPlayerDetails()
      .then((d) => {
        if (!aliveRef.current) return;
        onDetailsLoaded(d);
        onClearDetailsError();
        focusPlayerRow(playerId);
      })
      .catch(() => {
        if (aliveRef.current) onDetailsError();
      })
      .finally(() => {
        if (aliveRef.current) setRetrying(false);
      });
  }

  const showRetry = detailsError || retrying;

  return (
    <>
      {playerDetails?.reasoning && (
        <p className="mb-3 text-sm leading-relaxed text-slate-300">
          {playerDetails.reasoning}
        </p>
      )}
      {playerDetails?.profileSummary && (
        <p className="mb-4 rounded-xl border border-white/5 bg-white/5 p-3 text-xs leading-relaxed text-slate-400">
          {playerDetails.profileSummary}
        </p>
      )}
      {detailsLoading && !retrying && (
        <div
          className="mb-3 space-y-2"
          role="status"
          aria-busy="true"
          aria-label={playerNotesLoadingLabel()}
        >
          <div className="h-3 w-full animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <span className="sr-only">{playerNotesLoadingLabel()}…</span>
        </div>
      )}
      {showRetry && (
        <p className="mb-3 text-xs text-amber-400/90" role="alert">
          {playerNotesUnavailableCopy()}
          <button
            type="button"
            disabled={retrying}
            aria-busy={retrying || undefined}
            className="ml-2 underline decoration-amber-400/50 hover:text-amber-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80 disabled:cursor-wait disabled:opacity-70"
            onClick={retryDetails}
          >
            {playerNotesRetryLabel(retrying)}
          </button>
        </p>
      )}
    </>
  );
}
