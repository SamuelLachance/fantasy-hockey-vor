import { Header } from "@/components/Header";
import { RankingsTable } from "@/components/RankingsTable";
import { TopPlayers } from "@/components/TopPlayers";
import { getProjections } from "@/lib/data";

export default function HomePage() {
  const data = getProjections();

  return (
    <main className="min-h-screen pb-16">
      <Header
        season={data.season}
        playerCount={data.players.length}
        projectionEngine={data.projectionEngine}
        aiModel={data.aiModel}
      />

      <div className="mx-auto max-w-7xl space-y-10 px-4 py-10 sm:px-6 lg:px-8">
        <TopPlayers players={data.players} categoryWeights={data.categoryWeights} />
        <RankingsTable players={data.players} />
      </div>

      <footer className="border-t border-white/10 py-6 text-center text-xs text-slate-500">
        Projections generated {new Date(data.generatedAt).toLocaleDateString()}{" "}
        · {data.season} · {data.projectionEngine ?? "contextual"} · NHL API
      </footer>
    </main>
  );
}
