"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { useEffect, useRef } from "react";
import type { LeagueTab } from "@/lib/leagues/registry";
import { leagueTabPath } from "@/lib/leagues/routes";
import { useTabSearch } from "./tab-search";

/**
 * The league's tabs: plain links (one page per tab, `aria-current="page"`
 * on the active one), not an ARIA tablist. The bar scrolls sideways inside
 * its own box on phones; the active tab is brought into view on arrival.
 * Links keep the league's shared query (`?team=`) from React state.
 */
export function LeagueTabs({
  slug,
  tabs,
  widthClass,
}: {
  slug: string;
  tabs: ReadonlyArray<{ tab: LeagueTab; label: string }>;
  widthClass: string;
}) {
  // Called from the [ligue] layout: the segment one level down is the tab.
  const active = useSelectedLayoutSegment();
  const search = useTabSearch();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const a = activeRef.current;
    if (!box || !a) return;
    // Horizontal only: scrollIntoView would also scroll the page (and undo a #section jump).
    if (a.offsetLeft < box.scrollLeft || a.offsetLeft + a.offsetWidth > box.scrollLeft + box.clientWidth) {
      box.scrollLeft = Math.max(0, a.offsetLeft - 16);
    }
  }, [active]);

  return (
    <nav aria-label="Sections de la ligue">
      <div ref={boxRef} className="relative overflow-x-auto overscroll-x-contain">
        <div className={`mx-auto ${widthClass} px-2 sm:px-4 lg:px-6`}>
          <ul className="flex w-max gap-1">
            {tabs.map((t) => {
              const isActive = t.tab === active;
              return (
                <li key={t.tab} className="shrink-0">
                  <Link
                    ref={isActive ? activeRef : undefined}
                    href={leagueTabPath(slug, t.tab, search)}
                    prefetch={false}
                    aria-current={isActive ? "page" : undefined}
                    className={`relative inline-flex min-h-12 items-center whitespace-nowrap rounded-t-lg px-3 text-sm font-medium transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400 ${
                      isActive
                        ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-cyan-400"
                        : "text-slate-400 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {t.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
