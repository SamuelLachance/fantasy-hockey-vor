"use client";

import { useEffect, useState, type RefObject } from "react";

/** True once a horizontally scrollable element has scrolled past the left edge. */
export function useHorizontalScrollShadow(
  ref: RefObject<HTMLElement | null>,
): boolean {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setScrolled(el.scrollLeft > 2);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [ref]);

  return scrolled;
}
