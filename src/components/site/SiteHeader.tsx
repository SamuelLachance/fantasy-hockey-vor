import { Snowflake } from "lucide-react";
import { homeHref } from "@/lib/leagues/routes";
import { SITE_BRAND } from "@/lib/site";
import { SiteNavLinks } from "./SiteNavLinks";

/**
 * Global header on every page: the brand (home link) and the navigation.
 * Not sticky: the Yahoo draft helper pins its own status bar at the top.
 */
export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-slate-950/70 pt-[env(safe-area-inset-top,0px)]">
      <div className="mx-auto flex max-w-[96rem] flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-6 lg:px-8">
        {/* A plain link: a next/link to the root route fetches a payload Pages does not serve. */}
        <a
          href={homeHref()}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl pr-2 text-sm font-semibold uppercase tracking-[0.18em] text-cyan-300 transition motion-reduce:transition-none hover:text-cyan-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <Snowflake className="h-4 w-4 shrink-0" aria-hidden="true" />
          {SITE_BRAND}
        </a>
        <SiteNavLinks />
      </div>
    </header>
  );
}
