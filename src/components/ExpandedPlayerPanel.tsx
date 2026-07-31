"use client";

import type { Category, PlayerProjection } from "@/lib/types";
import { CATEGORY_LABELS, formatStat } from "@/lib/format";
import {
  detailStatSigma,
  type PlayerDetailRecord,
} from "@/lib/publish-players";
import {
  fetchPlayerDetails,
  resetPlayerDetailsCache,
} from "@/lib/player-details-client";
import { ExpandedPlayerMeta } from "./ExpandedPlayerMeta";

interface ExpandedPlayerPanelProps {
  player: PlayerProjection;
  cats: readonly Category[];
  playerDetails: PlayerDetailRecord | undefined;
  detailsLoading: boolean;
  detailsError: boolean;
  linkCopied: boolean;
  linkCopyFailed?: boolean;
  onCopyLink: () => void;
  onDetailsLoaded: (details: Record<string, PlayerDetailRecord>) => void;
  onDetailsError: () => void;
  onClearDetailsError: () => void;
}

export function ExpandedPlayerPanel({
  player,
  cats,
  playerDetails,
  detailsLoading,
  detailsError,
  linkCopied,
  linkCopyFailed = false,
  onCopyLink,
  onDetailsLoaded,
  onDetailsError,
  onClearDetailsError,
}: ExpandedPlayerPanelProps) {
  return (
    <div>
      <ExpandedPlayerMeta
        player={player}
        linkCopied={linkCopied}
        linkCopyFailed={linkCopyFailed}
        onCopyLink={onCopyLink}
      />
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cats.map((cat) => {
          const z = player.categoryZScores[cat] ?? 0;
          const width = Math.min(100, Math.max(8, 50 + z * 12));
          const sigma = detailStatSigma(playerDetails, cat);
          return (
            <div
              key={cat}
              className="rounded-xl border border-white/5 bg-white/5 p-3"
            >
              <div className="mb-1 flex justify-between text-xs text-slate-400">
                <span>{CATEGORY_LABELS[cat]}</span>
                <span className={z >= 0 ? "text-emerald-400" : "text-rose-400"}>
                  {z >= 0 ? "+" : ""}
                  {z.toFixed(2)} z
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-[width] duration-300 motion-reduce:transition-none"
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="mt-1 text-sm font-medium text-white">
                Proj: {formatStat(player, cat)}
                {sigma != null && cat !== "savePct" && (
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    ±
                    {sigma.toFixed(
                      cat === "goals" ||
                        cat === "assists" ||
                        cat === "powerplayPoints"
                        ? 1
                        : 0,
                    )}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
