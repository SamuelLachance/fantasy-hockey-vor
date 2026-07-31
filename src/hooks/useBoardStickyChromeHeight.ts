"use client";

import { useEffect } from "react";
import {
  BOARD_STICKY_CHROME_HEIGHT_VAR,
  BOARD_STICKY_CHROME_SELECTOR,
  syncBoardStickyChromeHeight,
} from "@/lib/board-dom";

/**
 * Keep `--board-sticky-chrome-height` on `#rankings` in sync so the table head
 * sticks just below the sticky toolbar/filters chrome.
 */
export function useBoardStickyChromeHeight(): void {
  useEffect(() => {
    const chrome = document.querySelector(BOARD_STICKY_CHROME_SELECTOR);
    const update = () => {
      syncBoardStickyChromeHeight();
    };
    update();
    if (!(chrome instanceof Element)) {
      return () => {
        document
          .getElementById("rankings")
          ?.style.removeProperty(BOARD_STICKY_CHROME_HEIGHT_VAR);
      };
    }
    const ro = new ResizeObserver(update);
    ro.observe(chrome);
    return () => {
      ro.disconnect();
      document
        .getElementById("rankings")
        ?.style.removeProperty(BOARD_STICKY_CHROME_HEIGHT_VAR);
    };
  }, []);
}
