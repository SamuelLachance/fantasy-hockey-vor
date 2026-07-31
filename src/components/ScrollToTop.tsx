"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { scrollPageTop } from "@/lib/board-dom";

const SHOW_AFTER = 480;
const HIDE_BELOW = 320;

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const y = window.scrollY;
        setVisible((was) => {
          if (was) return y > HIDE_BELOW;
          return y > SHOW_AFTER;
        });
        ticking = false;
      });
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      aria-label="Scroll to top"
      title="Scroll to top (Home)"
      aria-keyshortcuts="Home"
      onClick={scrollPageTop}
      className="fixed bottom-6 right-6 z-40 rounded-full border border-white/15 bg-slate-900/90 p-3 text-cyan-300 shadow-lg backdrop-blur transition motion-reduce:backdrop-blur-none motion-reduce:transition-none hover:border-cyan-500/40 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <ArrowUp className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
