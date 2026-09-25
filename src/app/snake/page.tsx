import type { Metadata } from "next";
import Link from "next/link";
import { readFileSync } from "fs";
import { join } from "path";
import { Mic } from "lucide-react";
import { SnakeDisclaimerShort } from "@/components/snake/SnakeDisclaimer";
import { SnakeExplorer } from "@/components/snake/SnakeExplorer";
import { SnakeMethodology } from "@/components/snake/SnakeMethodology";
import leagueJson from "@/data/fantrax/league.json";
import summaryJson from "@/data/snake-summary.json";
import { FANTRAX_DEFAULT_TEAM_ID } from "@/lib/fantrax/config";
import { SITE_BRAND } from "@/lib/site";
import { SNAKE_SCOUT_NAME, formatCountFr, formatSnakeDate } from "@/lib/snake/copy";
import type { SnakeSummaryFile } from "@/lib/snake/types";
import { boardHref } from "@/lib/snake/url";

// Baked by `npm run snake:build` (stats only; the page loads the data lazily).
const summary = summaryJson as unknown as SnakeSummaryFile;

const title = `Les opinions de Snake — base non officielle | ${SITE_BRAND}`;
const description =
  "Base de données non officielle des opinions de Simon « Snake » Boisvert sur les joueurs de hockey : résumés générés automatiquement à partir de ses balados publics, chacun relié au moment exact de la vidéo.";

// Public but unlisted (paraphrases attributed to a real person): never
// indexed, its own canonical, no share image (the inherited one is the
// English rankings artwork) and a plain "summary" card.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/snake" },
  robots: { index: false, follow: false },
  openGraph: {
    title,
    description,
    url: "/snake",
    siteName: SITE_BRAND,
    type: "website",
    locale: "fr_CA",
  },
  twitter: { card: "summary", title, description },
};

/** Fantrax ids on the user's team at the last league sync (build time). */
function myRoster(): { ids: string[]; teamName: string } {
  const league = leagueJson as unknown as { teams: Array<{ id: string; name: string }> };
  const teamName = league.teams.find((t) => t.id === FANTRAX_DEFAULT_TEAM_ID)?.name ?? "mon équipe";
  try {
    const state = JSON.parse(readFileSync(join(process.cwd(), "public", "fantrax", "state.json"), "utf8")) as {
      rosters?: Record<string, Array<{ id: string }>>;
    };
    const ids = (state.rosters?.[FANTRAX_DEFAULT_TEAM_ID] ?? []).map((r) => r.id).filter(Boolean);
    return { ids: [...new Set(ids)].sort(), teamName };
  } catch {
    return { ids: [], teamName };
  }
}

export default function SnakePage() {
  const s = summary.stats;
  const roster = myRoster();
  // Only the ids Snake talked about travel to the browser.
  const myIds = roster.ids.filter((id) => summary.fx[id]);

  return (
    <main lang="fr-CA" className="min-h-screen pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+3rem))]">
      {/* The shared root layout says lang="en"; this page is French. */}
      <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.lang="fr-CA"' }} />
      <header className="relative border-b border-white/10 bg-slate-950/80 pt-[env(safe-area-inset-top,0px)]">
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(52,211,153,0.12),_transparent_55%)]" />
        </div>
        <div className="relative mx-auto flex max-w-6xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
          <nav aria-label="Autres pages" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {/* Plain links to the board: next/link would prefetch its 1 MB
                payload on every visit, and on Pages its RSC request 404s
                (the root route's payload is index.txt) before a full load. */}
            <a
              href={boardHref()}
              hrefLang="en"
              className="inline-flex min-h-11 items-center rounded-sm text-cyan-400 underline-offset-2 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              ← Classement VOR <span className="ml-1 text-slate-400">(en anglais)</span>
            </a>
            <Link
              href="/league"
              prefetch={false}
              className="inline-flex min-h-11 items-center rounded-sm text-cyan-400 underline-offset-2 hover:text-cyan-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
            >
              Aide Fantrax quotidienne
            </Link>
          </nav>
          <div className="flex items-center gap-3 text-emerald-300">
            <Mic className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium uppercase tracking-[0.2em]">Balados publics · non officiel</span>
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Les opinions de Snake</h1>
            <p className="mt-2 max-w-3xl text-base text-slate-400">
              {`Ce que ${SNAKE_SCOUT_NAME} a dit de ${formatCountFr(s.players)} joueurs dans ${formatCountFr(s.citedVideos)} épisodes de balados publics, du ${formatSnakeDate(s.firstDate)} au ${formatSnakeDate(s.lastDate)} : une synthèse par joueur et chaque opinion datée, reliée au moment exact de la vidéo.`}
            </p>
          </div>
          <dl className="grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Joueurs", s.players],
              ["Opinions", s.opinions],
              ["Vidéos citées", s.citedVideos],
              ["Classements", s.rankings],
            ].map(([label, n]) => (
              <div
                key={label}
                className="flex flex-col-reverse rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center"
              >
                <dt className="text-xs uppercase tracking-wider text-slate-400">{label}</dt>
                <dd className="text-2xl font-bold tabular-nums text-white">{formatCountFr(Number(n))}</dd>
              </div>
            ))}
          </dl>
          <SnakeDisclaimerShort className="max-w-3xl" inPage />
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-10 px-4 py-8 sm:px-6 lg:px-8">
        <SnakeExplorer myFantraxIds={myIds} myTeamName={roster.teamName} />
        <div className="border-t border-white/10 pt-10">
          <SnakeMethodology stats={s} builtAt={summary.builtAt} />
        </div>
      </div>

      <footer className="mx-auto max-w-6xl border-t border-white/10 px-4 pt-6 text-center text-xs text-slate-400 sm:px-6 lg:px-8">
        {"Résumés non officiels générés automatiquement · aucune affiliation avec Simon Boisvert ni les émissions · "}
        <a
          href={boardHref()}
          hrefLang="en"
          className="inline-flex min-h-11 items-center rounded-sm text-cyan-500/80 underline-offset-2 transition hover:text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          Classement VOR
        </a>
        {" · "}
        <Link
          href="/league"
          prefetch={false}
          className="inline-flex min-h-11 items-center rounded-sm text-cyan-500/80 underline-offset-2 transition hover:text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          Aide Fantrax
        </Link>
      </footer>
    </main>
  );
}
