import type { ReactNode } from "react";
import { TAB_META, type LeagueTab } from "@/lib/leagues/registry";

/**
 * A tab's page: its h1 and one-line description, then the body. `bleed`
 * renders the body bare (the Yahoo draft helper lays out its own full-width
 * grid and sticky bar). Never sets `overflow`: it would break `sticky`.
 */
export function TabFrame({
  tab,
  widthClass,
  bleed = false,
  lead,
  children,
}: {
  tab: LeagueTab;
  widthClass: string;
  bleed?: boolean;
  /** The line under the h1 (the league kind's wording; the tab's generic one by default). */
  lead?: string;
  children: ReactNode;
}) {
  const meta = TAB_META[tab];
  return (
    <div className="pb-[max(3rem,calc(env(safe-area-inset-bottom,0px)+2rem))]">
      <div className={`mx-auto ${widthClass} px-4 pt-5 sm:px-6 lg:px-8 ${bleed ? "pb-1" : ""}`}>
        <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{meta.heading}</h1>
        <p className={`mt-1 text-sm text-slate-400 ${bleed ? "hidden sm:block" : ""}`}>{lead ?? meta.description}</p>
      </div>
      {bleed ? children : <div className={`mx-auto ${widthClass} px-4 py-5 sm:px-6 lg:px-8`}>{children}</div>}
    </div>
  );
}
