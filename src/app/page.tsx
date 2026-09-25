import type { Metadata } from "next";
import { BoardLinkNotice } from "@/components/home/BoardLinkNotice";
import { CategoryDraftLocal } from "@/components/home/CategoryDraftLocal";
import { LeagueHomeCard } from "@/components/home/LeagueHomeCard";
import { SnakeHomeCard } from "@/components/home/SnakeHomeCard";
import { homeLeagues, homeProjectionLine, homeSnake } from "@/lib/leagues/home-data";
import { SITE_BRAND } from "@/lib/site";
import { siteDefaultDescription, siteHomeTitle } from "@/lib/site-meta";

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
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Mes ligues</h1>
        <p className="mt-2 max-w-2xl text-base text-slate-400">
          Tout pour vos ligues au même endroit : alignements, repêchages, joueurs.
        </p>
      </div>
      <BoardLinkNotice />
      <div className="grid gap-6 lg:grid-cols-2">
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
