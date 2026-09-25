"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { LEAGUES, isLeagueTab } from "@/lib/leagues/registry";
import { switchLeaguePath } from "@/lib/leagues/routes";

/**
 * Pills to jump to another league, on the same tab when it has one (else
 * its default tab). Only with two leagues or more. The current league is
 * `aria-current="true"`: the tab bar's link is the one marked "page".
 */
export function LeagueSwitcher({ current }: { current: string }) {
  const segment = useSelectedLayoutSegment();
  const tab = segment && isLeagueTab(segment) ? segment : null;
  if (LEAGUES.length < 2) return null;
  return (
    <nav aria-label="Changer de ligue">
      <ul className="flex flex-wrap gap-2">
        {LEAGUES.map((l) => {
          const isCurrent = l.slug === current;
          return (
            <li key={l.slug}>
              <Link
                href={switchLeaguePath(tab, l)}
                prefetch={false}
                aria-current={isCurrent ? "true" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3 text-sm transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  isCurrent
                    ? "border-cyan-400/50 bg-cyan-500/15 font-semibold text-white"
                    : "border-white/10 bg-white/5 text-slate-300 hover:border-cyan-400/40 hover:text-white"
                }`}
              >
                {l.shortName}
                {/* The platform tag only where there is room (phones keep both pills on one line). */}
                <span className="hidden text-xs font-normal text-slate-400 sm:inline">{l.platform}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
