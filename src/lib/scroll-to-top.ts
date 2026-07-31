/** Pixels scrolled before the floating ScrollToTop control appears. */
export const SCROLL_TOP_SHOW_AFTER = 480;
/** Hide again only after scrolling back above this (hysteresis). */
export const SCROLL_TOP_HIDE_BELOW = 320;

/** Whether the ScrollToTop control should be visible given scrollY. */
export function scrollToTopVisible(
  scrollY: number,
  wasVisible: boolean,
): boolean {
  if (wasVisible) return scrollY > SCROLL_TOP_HIDE_BELOW;
  return scrollY > SCROLL_TOP_SHOW_AFTER;
}

/** Accessible name for the floating scroll control. */
export function scrollToTopAriaLabel(): string {
  return "Scroll to top";
}

/** Tooltip including the Home hotkey hint. */
export function scrollToTopTitle(): string {
  return "Scroll to top (Home)";
}
