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

    const cleanups: Array<() => void> = [];
    window.addEventListener("resize", update);
    cleanups.push(() => window.removeEventListener("resize", update));

    // iOS often reports intermediate sizes mid-rotate — resync after settle.
    let orientTimer = 0;
    const onOrientation = () => {
      update();
      window.clearTimeout(orientTimer);
      orientTimer = window.setTimeout(update, 250);
    };
    window.addEventListener("orientationchange", onOrientation);
    cleanups.push(() => {
      window.removeEventListener("orientationchange", onOrientation);
      window.clearTimeout(orientTimer);
    });

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", update);
      cleanups.push(() => vv.removeEventListener("resize", update));
    }

    if (chrome instanceof Element) {
      const ro = new ResizeObserver(update);
      ro.observe(chrome);
      cleanups.push(() => ro.disconnect());
    }

    return () => {
      for (const fn of cleanups) fn();
      document
        .getElementById("rankings")
        ?.style.removeProperty(BOARD_STICKY_CHROME_HEIGHT_VAR);
    };
  }, []);
}
