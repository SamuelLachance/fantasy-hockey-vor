"use client";

import { useEffect, useState, type RefObject } from "react";
import { horizontalScrollShadowVisible } from "@/lib/horizontal-scroll-shadow";

/** True once a horizontally scrollable element has scrolled past the left edge. */
export function useHorizontalScrollShadow(
  ref: RefObject<HTMLElement | null>,
): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      setScrolled(horizontalScrollShadowVisible(el.scrollLeft));
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

  return scrolled;
}
