/** Focus the toolbar Stats button that controls the filter panel. */
export function focusStatsFilterButton(): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLButtonElement>(
      '#rankings button[aria-keyshortcuts="f"]',
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

/** Tailwind top offset: safe-area + `--board-sticky-chrome-height` on `#rankings`. */
export const BOARD_STICKY_TOP_CLASS =
  "top-[calc(var(--board-safe-area-inset-top,0px)+var(--board-sticky-chrome-height,0px))]" as const;

/** Resolved safe-area top (px) for sticky scroll math. */
export function boardSafeAreaInsetTop(
  doc: { documentElement?: Element | null } | null =
    typeof document !== "undefined" ? document : null,
): number {
  const root = doc?.documentElement;
  if (!root || typeof getComputedStyle !== "function") return 0;
  const n = Number.parseFloat(
    getComputedStyle(root).getPropertyValue("--board-safe-area-inset-top"),
  );
  return Number.isFinite(n) ? n : 0;
}

/** Whether the user prefers reduced motion (SSR-safe → true). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Focus the board search field. */
export function focusBoardSearch(options?: { preventScroll?: boolean }): void {
  if (typeof document === "undefined") return;
  document
    .querySelector<HTMLInputElement>('#rankings input[type="search"]')
    ?.focus({ preventScroll: options?.preventScroll === true });
}

/**
 * Focus search once it exists — Suspense may delay `#rankings` search input
 * after Jump / skip-link / End scrolls to the shell.
 */
export function focusBoardSearchWhenReady(
  options?: { preventScroll?: boolean },
  attempts = 30,
): void {
  if (typeof document === "undefined") return;
  const preferPreventScroll = options?.preventScroll === true;
  const tryFocus = (): boolean => {
    const el = document.querySelector<HTMLInputElement>(
      '#rankings input[type="search"]',
    );
    if (!el) return false;
    el.focus({ preventScroll: preferPreventScroll });
    return true;
  };
  if (tryFocus()) return;
  let left = attempts;
  const tick = () => {
    if (tryFocus() || --left <= 0) return;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Focus a position filter tab (defaults to ALL). */
export function focusBoardPositionTab(position: "ALL" | string = "ALL"): void {
  if (typeof document === "undefined") return;
  document.getElementById(`board-pos-tab-${position}`)?.focus();
}

/**
 * After an active-filter chip unmounts, park focus on another chip control or
 * the ALL position tab so keyboard users are not dumped onto <body>.
 */
export function focusAfterActiveFilterClear(): void {
  if (typeof document === "undefined") return;
  queueMicrotask(() => {
    const strip = document.querySelector<HTMLElement>(
      '[aria-label="Active board filters"]',
    );
    if (strip) {
      const next =
        strip.querySelector<HTMLButtonElement>(
          'button[aria-label^="Clear"], button[aria-label^="Remove"], button[aria-label="Show starter goalies only"]',
        ) ?? strip.querySelector<HTMLButtonElement>("button");
      if (next) {
        next.focus();
        return;
      }
    }
    focusBoardPositionTab("ALL");
  });
}

/**
 * Run a write (e.g. router.replace) while pinning window scroll briefly.
 * Next App Router can still jump to top on query-only soft navigations even
 * with `{ scroll: false }` — restore scrollY across rAF + a short scroll lock.
 */
export function withPinnedWindowScroll(write: () => void): void {
  if (typeof window === "undefined") {
    write();
    return;
  }
  const x = window.scrollX;
  const y = window.scrollY;
  let pinning = true;
  const restore = () => {
    if (!pinning) return;
    if (window.scrollX !== x || window.scrollY !== y) {
      window.scrollTo(x, y);
    }
  };
  const onScroll = () => restore();
  window.addEventListener("scroll", onScroll, { passive: true });
  write();
  restore();
  requestAnimationFrame(() => {
    restore();
    requestAnimationFrame(() => {
      restore();
      window.setTimeout(() => {
        pinning = false;
        window.removeEventListener("scroll", onScroll);
      }, 120);
    });
  });
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
    // Do not let focus scroll fight the in-flight smooth scroll to #rankings.
    // Retry across rAF — search may still be behind Suspense.
    queueMicrotask(() =>
      focusBoardSearchWhenReady({ preventScroll: true }),
    );
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

/** Selector for the sticky board toolbar/filters chrome. */
export const BOARD_STICKY_CHROME_SELECTOR =
  "#rankings [data-board-sticky-chrome]" as const;

/** Sticky column header band under the chrome. */
export const BOARD_STICKY_THEAD_SELECTOR = "#rankings thead" as const;

/** CSS custom property set on `#rankings` for thead `top` offset. */
export const BOARD_STICKY_CHROME_HEIGHT_VAR =
  "--board-sticky-chrome-height" as const;

type QueryDoc = {
  querySelector: (selectors: string) => Element | null;
  getElementById?: (elementId: string) => HTMLElement | null;
};

function elementHeight(el: Element | null): number {
  if (!el || typeof el.getBoundingClientRect !== "function") return 0;
  return Math.max(0, el.getBoundingClientRect().height);
}

/** Height of sticky board chrome only (for CSS thead offset). */
export function boardStickyChromeHeight(
  doc: QueryDoc | null =
    typeof document !== "undefined" ? document : null,
): number {
  if (!doc) return 0;
  return elementHeight(doc.querySelector(BOARD_STICKY_CHROME_SELECTOR));
}

/**
 * Combined sticky top inset (chrome + table head) covering the viewport.
 * Used so expand / j-k scroll clears both sticky bands.
 */
export function boardStickyTopInset(
  doc: QueryDoc | null =
    typeof document !== "undefined" ? document : null,
): number {
  if (!doc) return 0;
  return (
    boardSafeAreaInsetTop() +
    boardStickyChromeHeight(doc) +
    elementHeight(doc.querySelector(BOARD_STICKY_THEAD_SELECTOR))
  );
}

/** Publish chrome height as a CSS var so thead sticks just below it. */
export function syncBoardStickyChromeHeight(
  doc: QueryDoc | null =
    typeof document !== "undefined" ? document : null,
): number {
  const h = boardStickyChromeHeight(doc);
  const root = doc?.getElementById?.("rankings");
  if (root) {
    root.style.setProperty(BOARD_STICKY_CHROME_HEIGHT_VAR, `${Math.round(h)}px`);
  }
  return h;
}

/**
 * Visible frame for sticky-aware scroll (mobile URL bar / keyboard).
 * Coordinates match getBoundingClientRect (layout viewport); callers should
 * subtract offsetTop before stickyAwareScrollDelta.
 */
export function boardVisualViewportFrame(
  win: {
    innerHeight: number;
    visualViewport?: { offsetTop: number; height: number } | null;
  } | null =
    typeof window !== "undefined" ? window : null,
): { offsetTop: number; height: number } {
  if (!win) return { offsetTop: 0, height: 0 };
  const vv = win.visualViewport;
  if (vv && typeof vv.height === "number" && vv.height > 0) {
    return {
      offsetTop: Number.isFinite(vv.offsetTop) ? vv.offsetTop : 0,
      height: vv.height,
    };
  }
  return { offsetTop: 0, height: win.innerHeight };
}

/**
 * Vertical scrollBy delta so a row clears sticky top chrome and stays in the
 * viewport. Pure — used by expand / j-k scroll.
 * Row/sticky coords must be relative to the visual viewport top (offsetTop = 0).
 */
export function stickyAwareScrollDelta(
  rowTop: number,
  rowBottom: number,
  stickyTop: number,
  viewportHeight: number,
  margin = 8,
): number {
  if (!(viewportHeight > 0)) return 0;
  const visibleTop = Math.max(0, stickyTop) + margin;
  const visibleBottom = viewportHeight - margin;
  if (!(visibleBottom > visibleTop)) return 0;

  if (rowTop < visibleTop) {
    return rowTop - visibleTop;
  }
  if (rowBottom > visibleBottom) {
    const rowHeight = rowBottom - rowTop;
    if (rowHeight > visibleBottom - visibleTop) {
      return rowTop - visibleTop;
    }
    return rowBottom - visibleBottom;
  }
  return 0;
}

/** Vertical union of two boxes (e.g. player row + details panel). */
export function unionVerticalBounds(
  a: { top: number; bottom: number },
  b: { top: number; bottom: number } | null | undefined,
): { top: number; bottom: number } {
  if (!b) return a;
  return {
    top: Math.min(a.top, b.top),
    bottom: Math.max(a.bottom, b.bottom),
  };
}

function scrollExpandedTargetIntoView(
  playerId: number,
  behavior: ScrollBehavior,
): void {
  const row = document.getElementById(`player-row-${playerId}`);
  if (!row) return;
  const panel = document.getElementById(`player-panel-${playerId}`);
  const bounds = unionVerticalBounds(
    row.getBoundingClientRect(),
    panel?.getBoundingClientRect(),
  );
  const frame = boardVisualViewportFrame();
  const delta = stickyAwareScrollDelta(
    bounds.top - frame.offsetTop,
    bounds.bottom - frame.offsetTop,
    boardStickyTopInset(),
    frame.height,
  );
  if (delta !== 0) {
    window.scrollBy({ top: delta, behavior });
  }
}

/** True when focus is on a rankings table sort header control. */
export function isBoardSortHeaderFocus(): boolean {
  if (typeof document === "undefined") return false;
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return !!el.closest("#rankings-board-table thead th button");
}

/** Keep an expanded player row + details panel clear of sticky chrome. */
export function scrollExpandedRowIntoView(
  playerId: number,
  opts?: { focus?: boolean },
): void {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const row = document.getElementById(`player-row-${playerId}`);
  if (!row) return;
  const motion = prefersReducedMotion() ? "auto" : "smooth";
  scrollExpandedTargetIntoView(playerId, motion);
  // Panel mounts/lays out after expand — remeasure next frames (instant correction).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollExpandedTargetIntoView(playerId, "auto");
    });
  });
  if (opts?.focus !== false && row instanceof HTMLElement) {
    row.focus({ preventScroll: true });
  }
}
