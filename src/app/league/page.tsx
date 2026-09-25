import type { Metadata } from "next";
import Link from "next/link";
import { LeagueDaily } from "@/components/league/LeagueDaily";
import leagueJson from "@/data/fantrax/league.json";
import todayJson from "@/data/fantrax/today.json";
import { FANTRAX_DEFAULT_TEAM_ID } from "@/lib/fantrax/config";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import type { LeagueSnapshot } from "@/lib/fantrax/snapshot-types";
import { SITE_BRAND } from "@/lib/site";

// Baked by `npm run league:sync` (the daily Action re-runs it before each build).
const league = leagueJson as unknown as LeagueSnapshot;
const today = todayJson as unknown as DailyPlan;

const title = `${league.leagueName} — aide quotidienne | ${SITE_BRAND}`;
const description =
  "Aide quotidienne non officielle pour la ligue Fantrax Captains Dynasty : légalité de l'alignement, capitaine, gardiens, plafonds de matchs, ballottage, repêchage et explorateur de joueurs (espoirs compris).";

// Public but unlisted: never indexed, its own canonical (the root layout's
// is "/"), and no owner names anywhere in the baked data. The inherited
// share image is the English rankings artwork, so the page overrides
// openGraph without one and uses a plain "summary" card.
export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/league" },
  robots: { index: false, follow: false },
  openGraph: {
    title,
    description,
    url: "/league",
    siteName: SITE_BRAND,
    type: "website",
    locale: "fr_CA",
  },
  twitter: { card: "summary", title, description },
};

export default function LeaguePage() {
  // Server-rendered props stay small: the default team's plan (~13 KB) and
  // the team names. Everything else is fetched by the browser on demand.
  const teams = league.teams
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr-CA"));
  const defaultTeamId = teams.some((t) => t.id === FANTRAX_DEFAULT_TEAM_ID)
    ? FANTRAX_DEFAULT_TEAM_ID
    : today.teamId;

  return (
    <main lang="fr-CA" className="min-h-screen pb-[max(4rem,calc(env(safe-area-inset-bottom,0px)+3rem))]">
      {/* The shared root layout says lang="en"; this page (title and meta
          included) is French. Switch before first paint so screen readers
          and translation prompts see fr-CA; LeagueDaily restores "en" when
          the user navigates away client-side. */}
      <script dangerouslySetInnerHTML={{ __html: 'document.documentElement.lang="fr-CA"' }} />
      <LeagueDaily
        initialPlan={today}
        teams={teams}
        leagueName={league.leagueName}
        defaultTeamId={defaultTeamId}
      />
      <footer className="mx-auto max-w-6xl border-t border-white/10 px-4 pt-6 text-center text-xs text-slate-400 sm:px-6 lg:px-8">
        Données : API publique de Fantrax (lecture seule) et calendrier de la LNH · projections{" "}
        {SITE_BRAND} · outil non officiel, sans lien avec Fantrax ni la LNH ·{" "}
        <Link
          href="/"
          className="inline-flex min-h-11 items-center rounded-sm text-cyan-500/80 underline-offset-2 transition hover:text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/80"
        >
          Classement VOR
        </Link>
      </footer>
    </main>
  );
}
