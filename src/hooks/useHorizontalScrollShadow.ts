"use client";

import { useEffect, type RefObject } from "react";
import { applyHorizontalScrollShadow } from "@/lib/horizontal-scroll-shadow";

/**
 * Toggle data-scrolled on a horizontally scrollable element.
 * Shadow styling is pure CSS (group-data) — no board re-render on scroll.
 */
export function useHorizontalScrollShadow(
  ref: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      applyHorizontalScrollShadow(el);
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
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [ref]);
}
