"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { LeagueTab } from "@/lib/leagues/registry";
import { leagueTabPath } from "@/lib/leagues/routes";
import { useTabSearch } from "./tab-search";

/**
 * Link to another tab of the same league, keeping what the league carries
 * from tab to tab (`?team=` for a non-default Fantrax team), optionally on
 * one of the tab table's views (`?vue=espoirs`).
 */
export function TabLink({
  slug,
  tab,
  vue,
  className = "inline-flex min-h-11 items-center gap-1 rounded-md font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400",
  children,
}: {
  slug: string;
  tab: LeagueTab;
  vue?: string;
  className?: string;
  children: ReactNode;
}) {
  const params = new URLSearchParams(useTabSearch());
  if (vue) params.set("vue", vue);
  const qs = params.toString();
  return (
    <Link href={leagueTabPath(slug, tab, qs ? `?${qs}` : "")} prefetch={false} className={className}>
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}
