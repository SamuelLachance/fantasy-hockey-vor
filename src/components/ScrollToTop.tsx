"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { scrollPageTop } from "@/lib/board-dom";

export function ScrollToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        setVisible(window.scrollY > 480);
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
      onClick={scrollPageTop}
      className="fixed bottom-6 right-6 z-40 rounded-full border border-white/15 bg-slate-900/90 p-3 text-cyan-300 shadow-lg backdrop-blur transition hover:border-cyan-500/40 hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
