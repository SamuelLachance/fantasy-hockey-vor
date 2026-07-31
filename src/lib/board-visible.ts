import type { PlayerProjection } from "@/lib/types";

/** Slice of filtered rankings currently mounted in the progressive table. */
export function visibleBoardPlayers(
  filtered: readonly PlayerProjection[],
  renderCount: number,
): PlayerProjection[] {
  const n = Math.max(0, Math.min(renderCount, filtered.length));
  return filtered.slice(0, n);
}

/**
 * Which mounted row is the single Tab stop (roving tabindex).
 * Expanded row wins; else last-expanded anchor if still mounted; else first row.
 */
export function boardRowTabStopId(
  visiblePlayers: readonly { id: number }[],
  expandedId: number | null,
  anchorId: number | null = null,
): number | null {
  if (expandedId != null) {
    if (visiblePlayers.some((p) => p.id === expandedId)) return expandedId;
  }
  if (anchorId != null && visiblePlayers.some((p) => p.id === anchorId)) {
    return anchorId;
  }
  return visiblePlayers[0]?.id ?? null;
}
