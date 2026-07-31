/** Pixels scrolled before sticky-name shadow engages. */
export const HORIZONTAL_SCROLL_SHADOW_PX = 2;

/** DOM attribute toggled on the horizontal scroll container when scrolled. */
export const HORIZONTAL_SCROLL_SCROLLED_ATTR = "data-scrolled";

/**
 * CSS custom property on the h-scroll container: viewport width for sticky
 * expanded-row panels (so details stay in view when category columns scroll).
 */
export const BOARD_HSCROLL_CLIENT_WIDTH_VAR = "--board-hscroll-client-width";

/** Whether the sticky player column should show its right-edge scroll shadow. */
export function horizontalScrollShadowVisible(scrollLeft: number): boolean {
  return scrollLeft > HORIZONTAL_SCROLL_SHADOW_PX;
}

/**
 * Drive sticky-column shadow via a DOM attribute (no React re-render).
 * CSS `group-data-[scrolled]/hscroll:` on sticky name cells reads this.
 */
export function applyHorizontalScrollShadow(el: HTMLElement): void {
  el.toggleAttribute(
    HORIZONTAL_SCROLL_SCROLLED_ATTR,
    horizontalScrollShadowVisible(el.scrollLeft),
  );
}

/** Sync h-scroll viewport width for sticky expanded panels. */
export function applyBoardHscrollClientWidth(el: HTMLElement): void {
  el.style.setProperty(BOARD_HSCROLL_CLIENT_WIDTH_VAR, `${el.clientWidth}px`);
}

/** Shadow attr + viewport width for the rankings h-scroll container. */
export function applyHorizontalScrollChrome(el: HTMLElement): void {
  applyHorizontalScrollShadow(el);
  applyBoardHscrollClientWidth(el);
}
