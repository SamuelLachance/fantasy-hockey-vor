"use client";

import { useState } from "react";
import type { PlayerDetailRecord } from "@/lib/publish-players";
import {
  fetchPlayerDetails,
  resetPlayerDetailsCache,
} from "@/lib/player-details-client";
import {
  playerNotesLoadingLabel,
  playerNotesRetryLabel,
  playerNotesUnavailableCopy,
} from "@/lib/player-notes-copy";

interface ExpandedPlayerNotesProps {
  playerDetails: PlayerDetailRecord | undefined;
  detailsLoading: boolean;
  detailsError: boolean;
  onDetailsLoaded: (details: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
}

/** Reasoning / profile / loading / retry for the expanded player panel. */
export function ExpandedPlayerNotes({
  playerDetails,
  detailsLoading,
  detailsError,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
}: ExpandedPlayerNotesProps) {
  const [retrying, setRetrying] = useState(false);

  function retryDetails() {
    if (retrying) return;
    setRetrying(true);
    resetPlayerDetailsCache();
    onClearDetailsError();
    void fetchPlayerDetails()
      .then((d) => {
        onDetailsLoaded(d);
      })
      .catch(onDetailsError)
      .finally(() => setRetrying(false));
  }

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
      {detailsLoading && (
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
      {detailsError && (
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
