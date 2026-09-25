import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { SCORING_TITLE, leagueChips, type LeagueEntry } from "@/lib/leagues/registry";
import { LeagueSwitcher } from "./LeagueSwitcher";

const ACCENT: Record<LeagueEntry["accent"], string> = {
  cyan: "text-cyan-300",
  violet: "text-violet-300",
};

/**
 * Top of every tab of a league: platform · format · scoring · teams, the
 * league name (a paragraph: each tab owns the page's h1), the link to the
 * league on its platform, the league switcher and the kind's own block.
 */
export function LeagueShellHeader({
  entry,
  widthClass,
  children,
}: {
  entry: LeagueEntry;
  widthClass: string;
  children?: ReactNode;
}) {
  const chips = leagueChips(entry);
  return (
    <div className={`mx-auto flex ${widthClass} flex-col gap-3 px-4 pb-3 pt-5 sm:px-6 lg:px-8`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className={`text-xs font-medium uppercase tracking-[0.18em] ${ACCENT[entry.accent]}`}>
          {chips.map((c, i) => (
            <span key={c}>
              {i === 2 ? <abbr title={SCORING_TITLE[entry.scoring]} className="no-underline">{c}</abbr> : c}
              {i < chips.length - 1 ? <span aria-hidden="true"> · </span> : null}
              {i < chips.length - 1 ? <span className="sr-only">, </span> : null}
            </span>
          ))}
        </p>
        <LeagueSwitcher current={entry.slug} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <p className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{entry.name}</p>
        {entry.externalUrl ? (
          <a
            href={entry.externalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1.5 rounded-md text-sm text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            Voir sur {entry.platform}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only"> (nouvel onglet)</span>
          </a>
        ) : null}
      </div>
      {children}
    </div>
  );
}
