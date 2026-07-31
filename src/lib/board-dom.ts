/** Focus the toolbar Stats button that controls the filter panel. */
export function focusStatsFilterButton(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLButtonElement>(
      '#rankings button[aria-controls="rankings-stat-filters"]',
    )
    ?.focus();
}

/** Right-edge shadow for sticky Player column after horizontal scroll. */
export const STICKY_NAME_SHADOW =
  "shadow-[4px_0_8px_-4px_rgba(0,0,0,0.5)]" as const;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
    queueMicrotask(() => {
      document
        .querySelector<HTMLInputElement>('#rankings input[type="search"]')
        ?.focus();
    });
  }
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
}
