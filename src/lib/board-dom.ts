/** Focus the toolbar Stats button that controls the filter panel. */
export function focusStatsFilterButton(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLButtonElement>(
      '#rankings button[aria-controls="rankings-stat-filters"]',
    )
    ?.focus();
}

/** Focus the first min bound input in the open stats filter panel. */
export function focusFirstStatFilterInput(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLInputElement>(
      '#rankings input[aria-label$="minimum"]',
    )
    ?.focus();
}

/** Right-edge shadow for sticky Player column after horizontal scroll (CSS-gated). */
export const STICKY_NAME_SHADOW =
  "group-data-[scrolled]/hscroll:shadow-[4px_0_8px_-4px_rgba(0,0,0,0.5)]" as const;

export const STICKY_NAME_BASE =
  "transition-shadow duration-150 motion-reduce:transition-none" as const;

/** Whether the user prefers reduced motion (SSR-safe → true). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focus the board search field. */
export function focusBoardSearch(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLInputElement>('#rankings input[type="search"]')
    ?.focus();
}

/** Smooth (or instant) scroll helpers for board shortcuts. */
export function scrollPageTop(): void {
  if (typeof window === "undefined") return;
  window.scrollTo({
    top: 0,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
}

export function scrollToRankings(options?: { focusSearch?: boolean }): void {
  if (typeof document === "undefined") return;
  document.getElementById("rankings")?.scrollIntoView({
    behavior: prefersReducedMotion() ? "auto" : "smooth",
    block: "start",
  });
  if (options?.focusSearch) {
    queueMicrotask(focusBoardSearch);
  }
}

/** Focus a board row (keyboard expand / j-k nav) without forcing a scroll jump. */
export function focusPlayerRow(playerId: number): void {
  if (typeof document === "undefined") return;
  const row = document.getElementById(`player-row-${playerId}`);
  if (!(row instanceof HTMLElement)) return;
  row.focus({ preventScroll: true });
}

/**
 * Before collapsing an expanded panel, move focus back to the row when focus
 * was inside the panel so unmount does not dump focus to body.
 */
export function focusPlayerRowIfPanelFocused(expandedId: number | null): void {
  if (expandedId == null || typeof document === "undefined") return;
  const active = document.activeElement;
  if (!(active instanceof Element)) return;
  if (!active.closest('[id^="player-panel-"]')) return;
  focusPlayerRow(expandedId);
}

/** Keep an expanded player row in view without jumping the page harshly. */
export function scrollExpandedRowIntoView(playerId: number): void {
  if (typeof document === "undefined") return;
  const row = document.getElementById(`player-row-${playerId}`);
  if (!row) return;
  row.scrollIntoView({
    block: "nearest",
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  if (row instanceof HTMLElement) {
    row.focus({ preventScroll: true });
  }
}
