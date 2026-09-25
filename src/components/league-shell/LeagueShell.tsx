import type { ReactNode } from "react";
import { TAB_META, type LeagueEntry } from "@/lib/leagues/registry";
import { LeagueShellHeader } from "./LeagueShellHeader";
import { LeagueTabs } from "./LeagueTabs";
import { SERVER_ADAPTERS } from "./server-adapters";

/**
 * Everything around a league's tabs (rendered by the league layout, so it
 * stays mounted from one tab to the next): the kind's providers, the league
 * header with its switcher, and the tab bar.
 */
export function LeagueShell({ entry, children }: { entry: LeagueEntry; children: ReactNode }) {
  const A = SERVER_ADAPTERS[entry.kind];
  const tabs = entry.tabs.map((tab) => ({ tab, label: TAB_META[tab].label }));
  return (
    <A.Shell entry={entry}>
      <div className="border-b border-white/10 bg-slate-950/40">
        <LeagueShellHeader entry={entry} widthClass={A.widthClass}>
          <A.Header entry={entry} />
        </LeagueShellHeader>
        <LeagueTabs slug={entry.slug} tabs={tabs} widthClass={A.widthClass} />
      </div>
      {children}
    </A.Shell>
  );
}
