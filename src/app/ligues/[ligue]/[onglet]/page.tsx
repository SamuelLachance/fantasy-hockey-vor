import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SERVER_ADAPTERS } from "@/components/league-shell/server-adapters";
import { TabFrame } from "@/components/league-shell/TabFrame";
import { TAB_META, getLeague, tabParams, type LeagueEntry, type LeagueTab } from "@/lib/leagues/registry";
import { leagueTabPath } from "@/lib/leagues/routes";
import { SITE_BRAND } from "@/lib/site";

export const dynamicParams = false;

type Params = Promise<{ ligue: string; onglet: string }>;

// Runs once per league the layout generates: that league's tabs only.
export function generateStaticParams({ params }: { params: { ligue: string } }): Array<{ onglet: LeagueTab }> {
  return tabParams(params.ligue);
}

function resolve(ligue: string, onglet: string): { entry: LeagueEntry; tab: LeagueTab } | null {
  const entry = getLeague(ligue);
  const tab = entry?.tabs.find((t) => t === onglet);
  return entry && tab ? { entry, tab } : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { ligue, onglet } = await params;
  const r = resolve(ligue, onglet);
  if (!r) return {};
  const { entry, tab } = r;
  // The root template appends « | Fantasy Hockey VOR ».
  const title = `${TAB_META[tab].label} — ${entry.shortName}`;
  const description = SERVER_ADAPTERS[entry.kind].describe(entry, tab);
  const path = leagueTabPath(entry.slug, tab);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} | ${SITE_BRAND}`,
      description,
      url: path,
      siteName: SITE_BRAND,
      type: "website",
      locale: "fr_CA",
    },
    twitter: { card: "summary", title: `${title} | ${SITE_BRAND}`, description },
  };
}

export default async function LeagueTabPage({ params }: { params: Params }) {
  const { ligue, onglet } = await params;
  const r = resolve(ligue, onglet);
  if (!r) notFound();
  const { entry, tab } = r;
  const A = SERVER_ADAPTERS[entry.kind];
  return (
    <TabFrame tab={tab} widthClass={A.widthClass} bleed={A.fullBleedTabs.includes(tab)} lead={A.lead(entry, tab)}>
      <A.Tab entry={entry} tab={tab} />
    </TabFrame>
  );
}
