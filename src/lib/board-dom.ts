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
