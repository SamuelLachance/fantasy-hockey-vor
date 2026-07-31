import type { PlayerProjection } from "@/lib/types";

/** Human label for a player's projectionMethod tag. */
export function projectionMethodLabel(
  method: PlayerProjection["projectionMethod"],
): string {
  if (method === "ai") return "AI projection";
  if (method === "ml") return "ML stacked ensemble";
  return "Contextual model";
}

export function projectionMethodTone(
  method: PlayerProjection["projectionMethod"],
): string {
  if (method === "ai") {
    return "bg-violet-500/20 text-violet-300 ring-1 ring-violet-500/30";
  }
  if (method === "ml") {
    return "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/30";
  }
  return "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30";
}
