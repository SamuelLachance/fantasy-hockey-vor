import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Crosshair } from "lucide-react";
import { BoardLinkNotice } from "@/components/home/BoardLinkNotice";
import { CategoryDraftLocal } from "@/components/home/CategoryDraftLocal";
import { LeagueHomeCard } from "@/components/home/LeagueHomeCard";
import { SnakeHomeCard } from "@/components/home/SnakeHomeCard";
import { homeLeagues, homeProjectionLine, homeSnake } from "@/lib/leagues/home-data";
import { SITE_BRAND } from "@/lib/site";
import { siteDefaultDescription, siteHomeTitle } from "@/lib/site-meta";
import { leagueTabPath } from "@/lib/leagues/routes";

const description = siteDefaultDescription();

// The root layout's title template only applies to child segments.
export const metadata: Metadata = {
  title: { absolute: siteHomeTitle() },
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: siteHomeTitle(),
    description,
    url: "/",
    siteName: SITE_BRAND,
    type: "website",
    locale: "fr_CA",
  },
};

/** « Mes ligues »: one card per league of the registry, then Snake. */
export default function HomePage() {
  const leagues = homeLeagues();
  const projections = homeProjectionLine();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <section className="relative isolate overflow-hidden rounded-3xl border border-cyan-400/20 bg-slate-950 px-5 py-7 sm:p-9">
        <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-32 -z-10 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
        <p className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-300"><Crosshair className="h-4 w-4" aria-hidden="true" /> Votre bureau de direction · Fantrax</p>
        <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">Mes ligues</h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-slate-400">Un plan pour ce soir. Une vision pour les prochaines saisons. Priorisez vos mouvements, mesurez vos forces et suivez vos décisions.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          {leagues.filter(({ entry }) => entry.platform === "Fantrax").map(({ entry }) => (
            <Link key={entry.slug} href={leagueTabPath(entry.slug, "aujourdhui")} prefetch={false} className={`inline-flex min-h-12 items-center gap-3 rounded-xl border px-4 text-sm font-semibold transition hover:bg-white/10 ${entry.accent === "amber" ? "border-amber-400/30 bg-amber-400/5 text-amber-200" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-200"}`}>
              Plan du jour · {entry.shortName}<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>
      <BoardLinkNotice />
      {/* Three leagues in a two-column grid left the third one alone on a
          second row, below the fold on a laptop, with the right half of its row
          empty. A third column from xl up keeps every league on one screen. */}
      <div className="grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        {leagues.map(({ entry, card, local }) => (
          <LeagueHomeCard key={entry.slug} card={card}>
            {local ? <CategoryDraftLocal {...local} /> : null}
          </LeagueHomeCard>
        ))}
      </div>
      <SnakeHomeCard data={homeSnake()} />
      {projections ? <p className="text-xs text-slate-400">{projections}</p> : null}
    </div>
  );
}
