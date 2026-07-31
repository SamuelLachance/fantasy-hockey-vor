import { formatSigned } from "@/lib/format";

/** Confidence chip text (0–1 → percent). */
export function confidenceChipCopy(confidence: number): string {
  return `Confidence: ${(confidence * 100).toFixed(0)}%`;
}

/** Show legacy confidence only when calibrated uncertainty is absent. */
export function shouldShowConfidenceChip(input: {
  confidence?: number | null;
  hasUncertainty: boolean;
}): boolean {
  return (
    input.confidence != null &&
    Number.isFinite(input.confidence) &&
    !input.hasUncertainty
  );
}

/** Consensus / model / optional Edge chip. */
export function marketEdgeChipCopy(input: {
  consensusRank: number;
  modelRank: number;
  draftValue?: number | null;
}): string {
  let s = `Consensus #${input.consensusRank} · model #${input.modelRank}`;
  if (input.draftValue != null) {
    s += ` · Edge ${formatSigned(input.draftValue)}`;
  }
  return s;
}

/** Tooltip for the uncertainty chip. */
export function uncertaintyChipTitle(): string {
  return "1σ season-total uncertainty. Aleatoric share = irreducible noise vs model disagreement.";
}

/** Visible uncertainty chip body. */
export function uncertaintyChipCopy(input: {
  gamesPlayedSigma: number;
  totalSigma?: number | null;
  aleatoricShare: number;
}): string {
  let s = `±${input.gamesPlayedSigma.toFixed(0)} GP`;
  if (input.totalSigma != null) {
    s += ` · Σσ ${input.totalSigma.toFixed(1)}`;
  }
  s += ` · ${(input.aleatoricShare * 100).toFixed(0)}% irreducible`;
  return s;
}
