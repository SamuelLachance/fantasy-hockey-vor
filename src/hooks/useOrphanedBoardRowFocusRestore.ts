"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { restoreOrphanedBoardRowFocus } from "@/lib/board-dom";
import {
  nextHadBoardRowFocus,
  shouldRestoreOrphanedBoardFocus,
} from "@/lib/board-keyboard";

/**
 * When filters/position unmount the focused player row, recover focus onto
 * the first remaining row (or search) instead of dumping onto document.body.
 * `[` / `]` and tab clicks both go through the same filter reset token.
 */
export function useOrphanedBoardRowFocusRestore(resetToken: string): void {
  const hadRowFocusRef = useRef(false);
  const skipMountRef = useRef(true);

  useEffect(() => {
    function onFocusIn() {
      hadRowFocusRef.current = nextHadBoardRowFocus(
        hadRowFocusRef.current,
        document.activeElement,
      );
    }
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  useLayoutEffect(() => {
    if (skipMountRef.current) {
      skipMountRef.current = false;
      return;
    }
    if (
      !shouldRestoreOrphanedBoardFocus(
        hadRowFocusRef.current,
        document.activeElement,
      )
    ) {
      return;
    }
    restoreOrphanedBoardRowFocus();
  }, [resetToken]);
}
