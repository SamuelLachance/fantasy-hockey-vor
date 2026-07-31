import { Header } from "@/components/Header";
import { RankingsTable } from "@/components/RankingsTable";
import { ScrollToTop } from "@/components/ScrollToTop";
import { TopPlayers } from "@/components/TopPlayers";
import { getProjections } from "@/lib/data";
import { rankingsJsonLd } from "@/lib/seo-jsonld";

function ageDaysAtBuild(generatedAt: string): number {
  const buildMs = Date.parse(
    process.env.NEXT_PUBLIC_BUILD_TIME ?? generatedAt,
  );
  const generatedMs = Date.parse(generatedAt);
  if (!Number.isFinite(buildMs) || !Number.isFinite(generatedMs)) return 0;
  return (buildMs - generatedMs) / (24 * 60 * 60 * 1000);
}

export default function HomePage() {
  const data = getProjections();
  const projectionAgeDays = ageDaysAtBuild(data.generatedAt);
  const detailsHref = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/player-details.json`.replace(
    /\/{2,}/g,
    "/",
  );

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

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        Projections generated{" "}
        <time dateTime={data.generatedAt}>
          {new Date(data.generatedAt).toISOString().slice(0, 10)}
        </time>{" "}
        · {data.season}{" "}
        · {(data.projectionEngine ?? "contextual").replace(/-/g, " ")} · NHL
        API
        {" · "}
        <a
          href="https://github.com/SamuelLachance/fantasy-hockey-vor"
          target="_blank"
          rel="noopener noreferrer"
          className="text-cyan-500/80 underline-offset-2 hover:text-cyan-400 hover:underline"
        >
          source
        </a>
        <span className="mx-2 text-slate-700">·</span>
        <span className="text-slate-600">
          board: / · f · v/e/u/g · ? · j/k · Esc · CSV/JSON/Link
        </span>
      </footer>
      <ScrollToTop />
    </main>
  );
}
