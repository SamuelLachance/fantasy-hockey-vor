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

/** True when the control auto-hides while still focused (aria-hidden trap). */
export function scrollToTopShouldRestoreFocus(
  visible: boolean,
  isFocused: boolean,
): boolean {
  return !visible && isFocused;
}

/** Accessible name for the floating scroll control. */
export function scrollToTopAriaLabel(): string {
  return "Scroll to top";
}

/** Tooltip for the floating scroll control. */
export function scrollToTopTitle(): string {
  return "Scroll to top";
}
