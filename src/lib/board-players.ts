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

export interface DeferredExpandState {
  expandedId: number | null;
  pendingPlayerId: number | null;
}

/**
 * Park a filter-hidden expand as pending and restore it when the player
 * reappears (depth goalies, position tab, search). Invalid ids are dropped.
 */
export function nextDeferredExpandState(opts: {
  allPlayers: readonly { id: number }[];
  filtered: readonly { id: number }[];
  expandedId: number | null;
  pendingPlayerId: number | null;
}): DeferredExpandState {
  const pending =
    opts.pendingPlayerId != null &&
    boardHasPlayerId(opts.allPlayers, opts.pendingPlayerId)
      ? opts.pendingPlayerId
      : null;

  if (opts.expandedId != null && boardHasPlayerId(opts.filtered, opts.expandedId)) {
    return { expandedId: opts.expandedId, pendingPlayerId: pending };
  }

  if (pending != null && boardHasPlayerId(opts.filtered, pending)) {
    return { expandedId: pending, pendingPlayerId: pending };
  }

  if (
    opts.expandedId != null &&
    boardHasPlayerId(opts.allPlayers, opts.expandedId)
  ) {
    return { expandedId: null, pendingPlayerId: opts.expandedId };
  }

  return { expandedId: null, pendingPlayerId: pending };
}

/** Linked player parked off the filtered board (depth / pos / search). */
export function hiddenLinkedPlayer<T extends { id: number }>(
  allPlayers: readonly T[],
  pendingPlayerId: number | null,
  expandedId: number | null,
): T | null {
  if (pendingPlayerId == null) return null;
  if (expandedId === pendingPlayerId) return null;
  return allPlayers.find((p) => p.id === pendingPlayerId) ?? null;
}

/** Player id for `p` copy-link: visible expand, else parked deep-link. */
export function boardCopyPlayerLinkId(
  expandedId: number | null,
  pendingPlayerId: number | null,
): number | null {
  return expandedId ?? pendingPlayerId;
}
