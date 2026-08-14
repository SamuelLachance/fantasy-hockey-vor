/** Next expanded player id for j/k / arrow navigation on the board. */
export function nextExpandedPlayerId(
  playerIds: readonly number[],
  expandedId: number | null,
  direction: 1 | -1,
): number | null {
  return nextExpandedPlayerIdByStep(playerIds, expandedId, direction, 1);
}

/** Rows skipped by PageUp / PageDown on the board. */
export const BOARD_PAGE_JUMP = 10;

/**
 * Whether keyboard nav is close enough to the mounted window edge that we
 * should grow the progressive list (load more).
 */
export function shouldPrefetchBoardPage(
  nextIndex: number,
  visibleCount: number,
  totalCount: number,
  threshold = BOARD_PAGE_JUMP,
): boolean {
  if (!(visibleCount < totalCount)) return false;
  if (!(nextIndex >= 0)) return false;
  return nextIndex >= Math.max(0, visibleCount - threshold);
}

/** Jump several rows for PageUp / PageDown (clamped to list ends). */
export function nextExpandedPlayerIdByStep(
  playerIds: readonly number[],
  expandedId: number | null,
  direction: 1 | -1,
  step: number,
): number | null {
  if (playerIds.length === 0) return null;
  const stride = Math.max(1, Math.floor(step));
  if (expandedId == null) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const idx = playerIds.indexOf(expandedId);
  if (idx < 0) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const next = Math.max(
    0,
    Math.min(playerIds.length - 1, idx + direction * stride),
  );
  return playerIds[next]!;
}

/** Enter / Space toggles an expanded rankings row. */
export function isBoardRowToggleKey(key: string): boolean {
  return key === "Enter" || key === " ";
}

/**
 * Player ids for j/k navigation.
 * Cold-start (nothing expanded) stays within the mounted window so `k` does not
 * expandVisibleFloor the entire filtered board.
 */
export function boardKeyboardNavIds(
  filteredIds: readonly number[],
  visibleCount: number,
  expandedId: number | null,
): number[] {
  if (expandedId != null) return [...filteredIds];
  const n = Math.max(0, Math.min(visibleCount, filteredIds.length));
  return filteredIds.slice(0, n);
}

type BoardFocusEl = {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
};

/** Whether focus is on a player row or its expanded panel. */
export function isBoardRowNavTarget(target: EventTarget | null): boolean {
  const el = asFocusEl(target);
  if (!el || typeof el.closest !== "function") return false;
  return Boolean(
    el.closest('tr[id^="player-row-"]') ||
      el.closest('[id^="player-panel-"]'),
  );
}

/**
 * Track whether the user last focused a board row. Ignore body/html so a
 * filter-driven unmount (focus dumps to body) does not clear the flag.
 */
export function nextHadBoardRowFocus(
  hadRowFocus: boolean,
  active: EventTarget | null,
): boolean {
  const el = asFocusEl(active);
  if (!el?.tagName) return hadRowFocus;
  const tag = el.tagName;
  if (tag === "BODY" || tag === "HTML") return hadRowFocus;
  const connected = (active as { isConnected?: boolean }).isConnected;
  if (connected === false) return hadRowFocus;
  return isBoardRowNavTarget(active);
}

/** Restore board focus after a filter unmounts the focused row onto body. */
export function shouldRestoreOrphanedBoardFocus(
  hadRowFocus: boolean,
  active: EventTarget | null,
): boolean {
  if (!hadRowFocus) return false;
  const el = asFocusEl(active);
  if (!el?.tagName) return true;
  const connected = (active as { isConnected?: boolean }).isConnected;
  if (connected === false) return true;
  const tag = el.tagName;
  return tag === "BODY" || tag === "HTML";
}

/** First / last id for Home / End while navigating board rows. */
export function boardHomeEndPlayerId(
  playerIds: readonly number[],
  key: "Home" | "End",
): number | null {
  if (playerIds.length === 0) return null;
  return key === "Home" ? playerIds[0]! : playerIds[playerIds.length - 1]!;
}

function asFocusEl(target: EventTarget | null): BoardFocusEl | null {
  if (!target || typeof target !== "object") return null;
  return target as BoardFocusEl;
}

/** Focus is in a text field where letter shortcuts must not fire. */
export function isBoardTypingTarget(target: EventTarget | null): boolean {
  const el = asFocusEl(target);
  if (!el?.tagName) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(el.isContentEditable);
}

/**
 * Focus is on toolbar / dialog / tab controls (not a player row).
 * Board letter shortcuts and Home/End must yield to these controls.
 */
export function isBoardChromeTarget(target: EventTarget | null): boolean {
  const el = asFocusEl(target);
  if (!el?.tagName) return false;
  if (isBoardTypingTarget(target)) return true;
  if (typeof el.closest !== "function") return false;
  if (el.closest('tr[id^="player-row-"]')) return false;
  if (el.closest('[id^="player-panel-"]')) return false;
  return Boolean(
    el.closest(
      'button, a[href], summary, [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="combobox"], [role="option"], [role="menuitem"], [role="dialog"]',
    ),
  );
}

/** Whether global board shortcuts (except Esc / ?) should no-op. */
export function shouldIgnoreBoardShortcut(
  helpOpen: boolean,
  target: EventTarget | null,
): boolean {
  if (helpOpen) return true;
  return isBoardChromeTarget(target);
}

export type BoardEscapeAction =
  | { type: "clear-search" }
  | { type: "dismiss-row"; blurSearch: boolean }
  | { type: "noop-typing" };

export type BoardEscapeLayerAction =
  | { type: "close-help" }
  | { type: "close-filters" }
  | { type: "clear-search" }
  | { type: "dismiss-row"; blurSearch: boolean }
  | { type: "noop" };

/** True while an IME composition session is active (CJK etc.). */
export function isBoardImeComposing(e: {
  isComposing?: boolean;
  key: string;
}): boolean {
  return Boolean(e.isComposing) || e.key === "Process";
}

/**
 * Escape while typing: clear non-empty search, otherwise dismiss the expanded
 * row (blur empty search so focus can move to the player row).
 */
export function nextBoardEscapeTypingAction(
  target: EventTarget | null,
): BoardEscapeAction {
  const el = asFocusEl(target);
  if (!el?.tagName) return { type: "dismiss-row", blurSearch: false };
  if (el.tagName === "INPUT") {
    const input = target as { type?: string; value?: string };
    if (input.type === "search") {
      if ((input.value ?? "") !== "") return { type: "clear-search" };
      return { type: "dismiss-row", blurSearch: true };
    }
  }
  return { type: "noop-typing" };
}

/**
 * Board-wide Escape ladder: help → filters → clear query (even off search) →
 * collapse expanded row. Matches empty-state "Esc clears search" advertising.
 */
export function nextBoardEscapeAction(opts: {
  helpOpen: boolean;
  filtersOpen: boolean;
  hasQuery: boolean;
  typing: boolean;
  target: EventTarget | null;
  expandedId: number | null;
}): BoardEscapeLayerAction {
  if (opts.helpOpen) return { type: "close-help" };
  if (opts.filtersOpen) return { type: "close-filters" };
  if (opts.typing) {
    const typingAction = nextBoardEscapeTypingAction(opts.target);
    if (typingAction.type === "clear-search") return { type: "clear-search" };
    if (typingAction.type === "noop-typing") return { type: "noop" };
    return {
      type: "dismiss-row",
      blurSearch: typingAction.blurSearch,
    };
  }
  if (opts.hasQuery) return { type: "clear-search" };
  if (opts.expandedId != null) {
    return { type: "dismiss-row", blurSearch: false };
  }
  return { type: "noop" };
}
