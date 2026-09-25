/**
 * The user's leagues: one entry per league drives the global navigation,
 * the home cards, the static routes (`/ligues/<slug>/<onglet>`), the old
 * URL redirects and the export checks. Client-safe: literals only, no `fs`
 * and no data imports.
 *
 * Adding a league = one entry here (plus, for a Yahoo categories league,
 * its profile `src/data/leagues/<profileSlug>.json`). A new kind of league
 * also needs its `KIND_TABS`, a server adapter and a table adapter.
 */
import { FANTRAX_DEFAULT_TEAM_ID, FANTRAX_LEAGUE_ID } from "@/lib/fantrax/config";

export const LEAGUE_KINDS = ["fantrax-points", "yahoo-categories"] as const;
export type LeagueKind = (typeof LEAGUE_KINDS)[number];

export const LEAGUE_TABS = ["aujourdhui", "repechage", "joueurs", "ballottage", "mon-equipe", "duel"] as const;
export type LeagueTab = (typeof LEAGUE_TABS)[number];

/** Tabs a kind of league can have (a league lists a subset, in its own order). */
export const KIND_TABS: Record<LeagueKind, readonly LeagueTab[]> = {
  "fantrax-points": ["aujourdhui", "repechage", "joueurs", "ballottage", "mon-equipe"],
  "yahoo-categories": ["repechage", "joueurs", "mon-equipe", "duel"],
};

export const TAB_META: Record<LeagueTab, { label: string; heading: string; description: string }> = {
  aujourdhui: {
    label: "Aujourd’hui",
    heading: "Aujourd’hui",
    description: "Légalité, alignement optimal et capitaine, gardiens, plafonds, calendrier.",
  },
  repechage: {
    label: "Repêchage",
    heading: "Repêchage",
    description: "Le repêchage en direct : au tour de qui, vos choix, meilleurs disponibles.",
  },
  joueurs: {
    label: "Joueurs",
    heading: "Joueurs de la ligue",
    description: "Tous les joueurs de la ligue : filtres, tris, colonnes.",
  },
  ballottage: {
    label: "Ballottage",
    heading: "Ballottage",
    description: "Joueurs autonomes et au ballottage à réclamer.",
  },
  "mon-equipe": {
    label: "Mon équipe",
    heading: "Mon équipe",
    description: "Votre effectif, ses valeurs et ses forces.",
  },
  duel: {
    label: "Duel de la semaine",
    heading: "Duel de la semaine",
    description: "Votre duel de la semaine, catégorie par catégorie.",
  },
};

/** An old address of a league page, and the tab it lands on (explicit, never the default tab). */
export interface LegacyPath {
  path: "/league" | "/draft/light-the-lamp";
  tab: LeagueTab;
}

export interface LeagueEntry {
  /** URL segment, `[a-z0-9-]+`. */
  slug: string;
  kind: LeagueKind;
  name: string;
  shortName: string;
  platform: "Fantrax" | "Yahoo";
  format: "dynastie" | "saison-unique" | "keeper";
  scoring: "points" | "categories";
  season: string;
  /** Asserted against the platform data by the tests. */
  teams: number;
  myTeamId: string;
  /** Tab order; a subset of `KIND_TABS[kind]`. */
  tabs: readonly LeagueTab[];
  /** One of `tabs`: where the nav and the league root land. */
  defaultTab: LeagueTab;
  legacyPaths: readonly LegacyPath[];
  /** The league on its platform; null when it cannot be confirmed from repo data. */
  externalUrl: string | null;
  /** yahoo-categories: `src/data/leagues/<p>.json` and `public/leagues/<p>/board.json`. */
  profileSlug?: string;
  accent: "cyan" | "violet";
}

export const LEAGUES: readonly LeagueEntry[] = [
  {
    slug: "captains-dynasty",
    kind: "fantrax-points",
    name: "Captains Dynasty League",
    shortName: "Captains Dynasty",
    platform: "Fantrax",
    format: "dynastie",
    scoring: "points",
    season: "2026-27",
    teams: 16,
    myTeamId: FANTRAX_DEFAULT_TEAM_ID,
    tabs: ["aujourdhui", "repechage", "joueurs", "ballottage", "mon-equipe"],
    defaultTab: "aujourdhui",
    legacyPaths: [{ path: "/league", tab: "aujourdhui" }],
    // leagueId confirmed by src/data/fantrax/league.json.
    externalUrl: `https://www.fantrax.com/fantasy/league/${FANTRAX_LEAGUE_ID}/home`,
    accent: "cyan",
  },
  {
    slug: "light-the-lamp",
    kind: "yahoo-categories",
    name: "Light the Lamp",
    shortName: "Light the Lamp",
    platform: "Yahoo",
    format: "saison-unique",
    scoring: "categories",
    season: "2026-27",
    teams: 12,
    myTeamId: "12",
    profileSlug: "light-the-lamp",
    tabs: ["repechage", "joueurs", "mon-equipe", "duel"],
    // After the draft (Sun Sep 27): "mon-equipe". The legacy path stays pinned to repechage.
    defaultTab: "repechage",
    legacyPaths: [{ path: "/draft/light-the-lamp", tab: "repechage" }],
    // leagueId 57419 confirmed by src/data/leagues/light-the-lamp.json.
    externalUrl: "https://hockey.fantasysports.yahoo.com/hockey/57419",
    accent: "violet",
  },
];

export const FORMAT_LABEL: Record<LeagueEntry["format"], string> = {
  dynastie: "Dynastie",
  "saison-unique": "Saison unique",
  keeper: "Keeper",
};

export const SCORING_LABEL: Record<LeagueEntry["scoring"], string> = {
  points: "Points",
  categories: "Catégories",
};

/** Full meaning of the scoring chip (title / screen readers). */
export const SCORING_TITLE: Record<LeagueEntry["scoring"], string> = {
  points: "Ligue à points",
  categories: "Têtes-à-têtes par catégories",
};

export function getLeague(slug: string): LeagueEntry | undefined {
  return LEAGUES.find((l) => l.slug === slug);
}

export function isLeagueTab(x: string): x is LeagueTab {
  return (LEAGUE_TABS as readonly string[]).includes(x);
}

/** `generateStaticParams` of `app/ligues/[ligue]`. */
export function leagueParams(): Array<{ ligue: string }> {
  return LEAGUES.map((l) => ({ ligue: l.slug }));
}

/** `generateStaticParams` of `app/ligues/[ligue]/[onglet]` for one league. */
export function tabParams(ligue: string): Array<{ onglet: LeagueTab }> {
  return (getLeague(ligue)?.tabs ?? []).map((onglet) => ({ onglet }));
}

/** Chips under a league name: « Fantrax · Dynastie · Points · 16 équipes ». */
export function leagueChips(entry: LeagueEntry): string[] {
  return [entry.platform, FORMAT_LABEL[entry.format], SCORING_LABEL[entry.scoring], `${entry.teams} équipes`];
}

/** Every page path (without basePath) that exists: home, Snake, each tab, each old address. */
export function knownPaths(): readonly string[] {
  const paths = ["/", "/snake"];
  for (const l of LEAGUES) {
    for (const t of l.tabs) paths.push(`/ligues/${l.slug}/${t}`);
    for (const p of l.legacyPaths) paths.push(p.path);
  }
  return paths;
}
