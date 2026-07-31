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
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            player.projectionMethod === "ai"
              ? "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30"
              : player.projectionMethod === "ml"
                ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30"
                : "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30"
          }`}
        >
          {player.projectionMethod === "ai"
            ? "AI projection"
            : player.projectionMethod === "ml"
              ? "ML stacked ensemble"
              : "Contextual model"}
        </span>
        {player.confidence != null && (
          <span className="text-xs text-slate-400">
            Confidence: {(player.confidence * 100).toFixed(0)}%
          </span>
        )}
        {player.syntheticMarketRank != null && (
          <span className="text-xs text-slate-400">
            Consensus #{player.syntheticMarketRank} · model #{player.rank}
            {player.draftValue != null
              ? ` · Edge ${player.draftValue > 0 ? "+" : ""}${player.draftValue}`
              : ""}
          </span>
        )}
        {player.uncertainty && (
          <span
            className="text-xs text-slate-400"
            title="1σ season-total uncertainty. Aleatoric share = irreducible noise vs model disagreement."
          >
            ±{player.uncertainty.gamesPlayedSigma.toFixed(0)} GP
            {player.uncertainty.total?.sigma != null
              ? ` · Σσ ${player.uncertainty.total.sigma.toFixed(1)}`
              : ""}
            {" · "}
            {(player.uncertainty.aleatoricShare * 100).toFixed(0)}% irreducible
          </span>
        )}
        <button
          type="button"
          className="ml-auto rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
          onClick={(e) => {
            e.stopPropagation();
            onCopyLink();
          }}
        >
          {linkCopied
            ? "Link copied"
            : linkCopyFailed
              ? "Copy failed"
              : "Copy player link"}
        </button>
      </div>
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
        <p className="mb-3 text-xs text-slate-500">Loading player notes...</p>
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
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
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
