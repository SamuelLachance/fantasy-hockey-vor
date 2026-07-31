/** Next expanded player id for j/k / arrow navigation on the board. */
export function nextExpandedPlayerId(
  playerIds: readonly number[],
  expandedId: number | null,
  direction: 1 | -1,
): number | null {
  if (playerIds.length === 0) return null;
  if (expandedId == null) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const idx = playerIds.indexOf(expandedId);
  if (idx < 0) {
    return direction > 0 ? playerIds[0]! : playerIds[playerIds.length - 1]!;
  }
  const next = idx + direction;
  if (next < 0 || next >= playerIds.length) return expandedId;
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

/**
 * Escape while typing: clear non-empty search, otherwise dismiss the expanded
 * row (blur empty search so focus leaves the field).
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
