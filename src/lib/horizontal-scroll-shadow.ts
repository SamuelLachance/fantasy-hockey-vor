/** Pixels scrolled before sticky-name shadow engages. */
export const HORIZONTAL_SCROLL_SHADOW_PX = 2;

/** Whether the sticky player column should show its right-edge scroll shadow. */
export function horizontalScrollShadowVisible(scrollLeft: number): boolean {
  return scrollLeft > HORIZONTAL_SCROLL_SHADOW_PX;
}
