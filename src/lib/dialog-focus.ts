/** True when computed CSS takes the node out of visual/tab order. */
export function computedStyleHidesFromTab(style: {
  display: string;
  visibility: string;
}): boolean {
  return (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.visibility === "collapse"
  );
}

function elementIsCssHidden(el: HTMLElement): boolean {
  if (typeof globalThis.getComputedStyle !== "function") return false;
  return computedStyleHidesFromTab(globalThis.getComputedStyle(el));
}

/** Focusable elements inside a dialog root (Tab cycle). */
export function dialogFocusableElements(root: ParentNode): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((el) => {
    if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") {
      return false;
    }
    const ti = el.getAttribute("tabindex");
    if (ti != null && Number(ti) < 0) return false;
    // Skip controls that AT / Tab should not reach (hidden or inert subtree).
    if (el.closest("[inert], [hidden], [aria-hidden='true']")) return false;
    if (elementIsCssHidden(el)) return false;
    return true;
  });
}

/**
 * Trap Tab / Shift+Tab inside a dialog. Returns true when the event was handled.
 * If focus is outside the dialog focusables, pull it back to first/last.
 */
export function trapDialogTabKey(
  e: { key: string; shiftKey: boolean; preventDefault: () => void },
  focusable: readonly HTMLElement[],
  active: Element | null,
): boolean {
  if (e.key !== "Tab" || focusable.length === 0) return false;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  const inside = active != null && focusable.includes(active as HTMLElement);

  if (!inside) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
    return true;
  }
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

/** True when a backdrop click started and ended on the overlay (not a drag-out). */
export function shouldCloseDialogOnBackdropClick(
  pointerDownOnBackdrop: boolean,
  clickTarget: EventTarget | null,
  backdrop: EventTarget | null,
): boolean {
  return (
    pointerDownOnBackdrop &&
    clickTarget != null &&
    backdrop != null &&
    clickTarget === backdrop
  );
}
