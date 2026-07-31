import type { PlayerProjection } from "@/lib/types";
import {
  playerLinkAriaLabel,
  playerLinkButtonLabel,
} from "@/lib/copy-flash";
import { formatSigned } from "@/lib/format";
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
      {player.confidence != null && (
        <span className="text-xs tabular-nums text-slate-400">
          Confidence: {(player.confidence * 100).toFixed(0)}%
        </span>
      )}
      {player.syntheticMarketRank != null && (
        <span className="text-xs tabular-nums text-slate-400">
          Consensus #{player.syntheticMarketRank} · model #{player.rank}
          {player.draftValue != null
            ? ` · Edge ${formatSigned(player.draftValue)}`
            : ""}
        </span>
      )}
      {player.uncertainty && (
        <span
          className="text-xs tabular-nums text-slate-400"
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
        title="Copy player link (p)"
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
