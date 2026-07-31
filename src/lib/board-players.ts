/** Whether `id` exists in the current board player list. */
export function boardHasPlayerId(
  players: readonly { id: number }[],
  id: number | null | undefined,
): boolean {
  if (id == null || !Number.isFinite(id)) return false;
  return players.some((p) => p.id === id);
}

/**
 * Keep expand only while the player remains in the visible (filtered) list.
 * Clears deep-links and filter-hidden expands so URL / j-k stay coherent.
 */
export function coerceExpandedPlayerId(
  players: readonly { id: number }[],
  expandedId: number | null,
): number | null {
  if (expandedId == null) return null;
  return boardHasPlayerId(players, expandedId) ? expandedId : null;
}
