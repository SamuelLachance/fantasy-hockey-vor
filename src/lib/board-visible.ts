import type { PlayerProjection } from "@/lib/types";

/** Slice of filtered rankings currently mounted in the progressive table. */
export function visibleBoardPlayers(
  filtered: readonly PlayerProjection[],
  renderCount: number,
): PlayerProjection[] {
  const n = Math.max(0, Math.min(renderCount, filtered.length));
  return filtered.slice(0, n);
}
