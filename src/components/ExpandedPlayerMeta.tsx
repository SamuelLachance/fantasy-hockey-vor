import type { PlayerProjection } from "@/lib/types";
import {
  playerLinkAriaLabel,
  playerLinkButtonLabel,
  playerLinkTitle,
} from "@/lib/copy-flash";
import {
  confidenceChipCopy,
  marketEdgeChipCopy,
  shouldShowConfidenceChip,
  uncertaintyChipCopy,
  uncertaintyChipTitle,
} from "@/lib/expanded-meta-copy";
import {
  projectionMethodLabel,
  projectionMethodTone,
} from "@/lib/projection-method";

interface ExpandedPlayerMetaProps {
  player: PlayerProjection;
  linkCopied: boolean;
  linkCopyFailed: boolean;
  onCopyLink: () => void;
}

/** Projection method / confidence / market chips above expand details. */
export function ExpandedPlayerMeta({
  player,
  linkCopied,
  linkCopyFailed,
  onCopyLink,
}: ExpandedPlayerMetaProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span
        className={`rounded-full px-3 py-1 text-xs font-semibold ${projectionMethodTone(player.projectionMethod)}`}
      >
        {projectionMethodLabel(player.projectionMethod)}
      </span>
      {shouldShowConfidenceChip({
        confidence: player.confidence,
        hasUncertainty: !!player.uncertainty,
      }) && (
        <span className="text-xs tabular-nums text-slate-400">
          {confidenceChipCopy(player.confidence!)}
        </span>
      )}
      {player.syntheticMarketRank != null && (
        <span className="text-xs tabular-nums text-slate-400">
          {marketEdgeChipCopy({
            consensusRank: player.syntheticMarketRank,
            modelRank: player.rank,
            draftValue: player.draftValue,
          })}
        </span>
      )}
      {player.uncertainty && (
        <span
          className="text-xs tabular-nums text-slate-400"
          title={uncertaintyChipTitle()}
        >
          {uncertaintyChipCopy({
            gamesPlayedSigma: player.uncertainty.gamesPlayedSigma,
            totalSigma: player.uncertainty.total?.sigma,
            aleatoricShare: player.uncertainty.aleatoricShare,
          })}
        </span>
      )}
      <button
        type="button"
        className="ml-auto inline-flex min-h-11 items-center rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        title={playerLinkTitle()}
        aria-live="polite"
        aria-keyshortcuts="p"
        aria-label={playerLinkAriaLabel(
          player.name,
          linkCopied,
          linkCopyFailed,
        )}
        onClick={(e) => {
          e.stopPropagation();
          onCopyLink();
        }}
      >
        {playerLinkButtonLabel(linkCopied, linkCopyFailed)}
      </button>
    </div>
  );
}
