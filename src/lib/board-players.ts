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

/** Chrome Show chip: only when the board still has rows (empty state owns the rest). */
export function linkedPlayerChipName(
  name: string | null | undefined,
  filteredCount: number,
): string | null {
  if (!name || filteredCount <= 0) return null;
  return name;
}

export interface BoardLinkedPlayerView<T extends { id: number; name: string }> {
  expandedPlayer: T | undefined;
  pendingPlayer: T | null;
  /** Address bar / details fetch: visible expand, else parked deep-link. */
  urlPlayerId: number | null;
  titlePlayerName: string | null;
  chipPlayerName: string | null;
  emptyPlayerName: string | null;
}

/** Single derivation for URL, title, chrome chip, empty state, and details. */
export function boardLinkedPlayerView<T extends { id: number; name: string }>(opts: {
  allPlayers: readonly T[];
  filtered: readonly T[];
  expandedId: number | null;
  pendingPlayerId: number | null;
}): BoardLinkedPlayerView<T> {
  const expandedPlayer =
    opts.expandedId != null
      ? opts.filtered.find((p) => p.id === opts.expandedId)
      : undefined;
  const pendingPlayer = hiddenLinkedPlayer(
    opts.allPlayers,
    opts.pendingPlayerId,
    opts.expandedId,
  );
  const pendingName = pendingPlayer?.name ?? null;
  return {
    expandedPlayer,
    pendingPlayer,
    urlPlayerId: boardCopyPlayerLinkId(opts.expandedId, opts.pendingPlayerId),
    titlePlayerName: expandedPlayer?.name ?? pendingName,
    chipPlayerName: linkedPlayerChipName(pendingName, opts.filtered.length),
    emptyPlayerName: pendingName,
  };
}
