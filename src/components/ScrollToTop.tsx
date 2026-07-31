"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp } from "lucide-react";
import { focusBoardSearch, scrollPageTop } from "@/lib/board-dom";
import {
  SCROLL_TOP_HIDE_BELOW,
  SCROLL_TOP_SHOW_AFTER,
  scrollToTopAriaLabel,
  scrollToTopShouldRestoreFocus,
  scrollToTopTitle,
  scrollToTopVisible,
} from "@/lib/scroll-to-top";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const vv = window.visualViewport;
        const y =
          vv && typeof vv.pageTop === "number"
            ? vv.pageTop
            : window.scrollY;
        setVisible((was) => scrollToTopVisible(y, was));
        ticking = false;
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const vv = window.visualViewport;
    vv?.addEventListener("scroll", onScroll, { passive: true });
    vv?.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      vv?.removeEventListener("scroll", onScroll);
      vv?.removeEventListener("resize", onScroll);
    };
  }, []);

  useEffect(() => {
    if (
      !scrollToTopShouldRestoreFocus(
        visible,
        document.activeElement === buttonRef.current,
      )
    ) {
      return;
    }
    focusBoardSearch();
  }, [visible]);

  return (
    <button
      ref={buttonRef}
      type="button"
      aria-label={scrollToTopAriaLabel()}
      title={scrollToTopTitle()}
      aria-hidden={!visible || undefined}
      tabIndex={visible ? 0 : -1}
      onClick={() => {
        scrollPageTop();
        queueMicrotask(focusBoardSearch);
      }}
      className={`fixed z-40 inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-white/15 bg-slate-900/90 p-3 text-cyan-300 shadow-lg backdrop-blur transition motion-reduce:backdrop-blur-none motion-reduce:transition-none hover:border-cyan-500/40 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
        visible
          ? ""
          : "pointer-events-none invisible"
      }`}
      style={{
        bottom:
          "max(1.5rem, calc(env(safe-area-inset-bottom, 0px) + 0.75rem))",
        right:
          "max(1.5rem, calc(env(safe-area-inset-right, 0px) + 0.75rem))",
      }}
      data-show-after={SCROLL_TOP_SHOW_AFTER}
      data-hide-below={SCROLL_TOP_HIDE_BELOW}
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
