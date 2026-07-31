"use client";

import { useLayoutEffect, type RefObject } from "react";
import { applyHorizontalScrollChrome } from "@/lib/horizontal-scroll-shadow";

/**
 * Toggle data-scrolled + --board-hscroll-client-width on a horizontally
 * scrollable element. Shadow styling is pure CSS (group-data); expanded panels
 * read the width var — no board re-render on scroll.
 */
export function useHorizontalScrollShadow(
  ref: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      applyHorizontalScrollChrome(el);
    };
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };
    update();
    el.addEventListener("scroll", onScroll, { passive: true });
    // Window resize can change clientWidth / scrollbar gutters without a
    // content-box ResizeObserver fire in some browsers.
    window.addEventListener("resize", update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref]);
}
