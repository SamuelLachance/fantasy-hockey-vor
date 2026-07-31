import { Header } from "@/components/Header";
import { RankingsTable } from "@/components/RankingsTable";
import { ScrollToTop } from "@/components/ScrollToTop";
import { SiteFooter } from "@/components/SiteFooter";
import { TopPlayers } from "@/components/TopPlayers";
import { getProjections } from "@/lib/data";
import { projectionAgeDays as daysSinceProjection } from "@/lib/projection-age";
import { rankingsJsonLd } from "@/lib/seo-jsonld";
import { playerDetailsHref } from "@/lib/site";

export default function HomePage() {
  const data = getProjections();
  const projectionAgeDays = daysSinceProjection(
    data.generatedAt,
    process.env.NEXT_PUBLIC_BUILD_TIME,
  );
  const detailsHref = playerDetailsHref();

  const jsonLd = rankingsJsonLd(data);

  return (
    <main className="min-h-screen pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <link
        rel="preload"
        href={detailsHref}
        as="fetch"
        crossOrigin="anonymous"
      />
      <Header
        season={data.season}
        playerCount={data.players.length}
        leagueTeams={data.league?.teams}
        generatedAt={data.generatedAt}
        projectionAgeDays={projectionAgeDays}
        projectionEngine={data.projectionEngine}
        aiModel={data.aiModel}
      />

      <div className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <TopPlayers
          players={data.players}
          categoryWeights={data.categoryWeights}
          league={data.league}
        />
        <RankingsTable players={data.players} />
      </div>

      <SiteFooter
        season={data.season}
        generatedAt={data.generatedAt}
        playerCount={data.players.length}
        projectionEngine={data.projectionEngine}
      />
      <ScrollToTop />
    </main>
  );
}
