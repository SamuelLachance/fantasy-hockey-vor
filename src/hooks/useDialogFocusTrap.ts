"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import {
  dialogFocusableElements,
  trapDialogTabKey,
} from "@/lib/dialog-focus";

/**
 * Lock body scroll, restore focus on close, and trap Tab inside a dialog root.
 * Optionally wires Escape → onClose.
 */
export function useDialogFocusTrap(
  open: boolean,
  rootId: string,
  onClose?: () => void,
) {
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    // Capture opener before moving focus into the dialog.
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = document.getElementById(rootId);
    if (!root) return;
    // Prefer the dialog panel when it is programmatically focusable so AT
    // hears the title/description before the first control (e.g. Close).
    if (root.hasAttribute("tabindex")) {
      root.focus();
      return;
    }
    dialogFocusableElements(root)[0]?.focus();
  }, [open, rootId]);

  useLayoutEffect(() => {
    if (!open) return;
    const body = document.body;
    const scrollY = window.scrollY;
    const prevOverflow = body.style.overflow;
    const prevPosition = body.style.position;
    const prevTop = body.style.top;
    const prevWidth = body.style.width;
    // position:fixed + top offset stops iOS background scroll under the modal.
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    // Apply inert before paint so Tab / browse mode cannot reach the page.
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(body.children)) {
      if (!(child instanceof HTMLElement)) continue;
      if (child.dataset.dialogPortal === rootId) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && onCloseRef.current) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      const root = document.getElementById(rootId);
      if (!root) return;
      trapDialogTabKey(
        e,
        dialogFocusableElements(root),
        document.activeElement,
      );
    }
    window.addEventListener("keydown", onKey);
    return () => {
      body.style.overflow = prevOverflow;
      body.style.position = prevPosition;
      body.style.top = prevTop;
      body.style.width = prevWidth;
      window.scrollTo(0, scrollY);
      for (const el of inerted) el.removeAttribute("inert");
      window.removeEventListener("keydown", onKey);
      const restore = previouslyFocused.current;
      if (restore?.isConnected) restore.focus();
    };
  }, [open, rootId]);
}
