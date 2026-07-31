/** Pixels scrolled before sticky-name shadow engages. */
export const HORIZONTAL_SCROLL_SHADOW_PX = 2;

/** DOM attribute toggled on the horizontal scroll container when scrolled. */
export const HORIZONTAL_SCROLL_SCROLLED_ATTR = "data-scrolled";

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
