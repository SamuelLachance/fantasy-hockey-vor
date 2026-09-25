import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { LeagueShell } from "@/components/league-shell/LeagueShell";
import { getLeague, leagueParams } from "@/lib/leagues/registry";

// One static set of pages per registry league; anything else is a 404
// (whose recovery script sends league roots and old URLs on).
export const dynamicParams = false;

export function generateStaticParams(): Array<{ ligue: string }> {
  return leagueParams();
}

export default async function LeagueLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ ligue: string }>;
}) {
  const { ligue } = await params;
  const entry = getLeague(ligue);
  if (!entry) notFound();
  return <LeagueShell entry={entry}>{children}</LeagueShell>;
}
