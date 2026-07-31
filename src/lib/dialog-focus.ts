/** Focusable elements inside a dialog root (Tab cycle). */
export function dialogFocusableElements(root: ParentNode): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => !el.hasAttribute("disabled"));
}

/**
 * Trap Tab / Shift+Tab inside a dialog. Returns true when the event was handled.
 */
export function trapDialogTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  focusable: readonly HTMLElement[],
  active: Element | null,
): boolean {
  if (e.key !== "Tab" || focusable.length === 0) return false;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
    return true;
  }
  if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
