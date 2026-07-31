"use client";

import type { PlayerDetailRecord } from "@/lib/publish-players";
import {
  fetchPlayerDetails,
  resetPlayerDetailsCache,
} from "@/lib/player-details-client";

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
          aria-label="Loading player notes"
        >
          <div className="h-3 w-full animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-5/6 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-white/10 motion-reduce:animate-none" />
          <span className="sr-only">Loading player notes…</span>
        </div>
      )}
      {detailsError && (
        <p className="mb-3 text-xs text-amber-400/90">
          Player notes unavailable — expand again to retry.
          <button
            type="button"
            className="ml-2 underline decoration-amber-400/50 hover:text-amber-300"
            onClick={() => {
              resetPlayerDetailsCache();
              onClearDetailsError();
              void fetchPlayerDetails()
                .then(onDetailsLoaded)
                .catch(onDetailsError);
            }}
          >
            Retry
          </button>
        </p>
      )}
    </>
  );
}
