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
    dialogFocusableElements(root)[0]?.focus();
  }, [open, rootId]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      const restore = previouslyFocused.current;
      if (restore?.isConnected) restore.focus();
    };
  }, [open, rootId]);
}
