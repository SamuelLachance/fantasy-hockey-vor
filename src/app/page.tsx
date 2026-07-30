import { Header } from "@/components/Header";
import { RankingsTable } from "@/components/RankingsTable";
import { TopPlayers } from "@/components/TopPlayers";
import { getProjections } from "@/lib/data";

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

  return (
    <main className="min-h-screen pb-16">
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
        {new Date(data.generatedAt).toISOString().slice(0, 10)} · {data.season}{" "}
        · {(data.projectionEngine ?? "contextual").replace(/-/g, " ")} · NHL
        API
        {" · "}
        <a
          href="https://github.com/SamuelLachance/fantasy-hockey-vor"
          className="text-cyan-500/80 underline-offset-2 hover:text-cyan-400 hover:underline"
        >
          source
        </a>
      </footer>
    </main>
  );
}
