/**
 * Server side of each kind of league: the providers every tab shares (held
 * by the league layout, so they survive tab changes), the kind's block in
 * the league header, and each tab's body. Server components: they read the
 * committed data at build time and hand baked props to the client pieces
 * (`client-parts.tsx`, one chunk each, so a page only loads its own kind
 * and tab). The home page does not come through here (see
 * `src/lib/leagues/home-data.ts`).
 */
import type { ReactNode } from "react";
import { CategoryDuelTab } from "@/components/draft/CategoryDuelTab";
import { CategoryLeagueHeader } from "@/components/draft/CategoryLeagueHeader";
import { CategoryPlayersTab } from "@/components/draft/CategoryPlayersTab";
import { fantraxLeague } from "@/lib/fantrax/config";
import summaryJson from "@/data/snake-summary.json";
import { fantraxBaked, fantraxHasDynasty } from "@/lib/fantrax/baked";
import { FORMAT_LABEL, TAB_META, type LeagueEntry, type LeagueKind, type LeagueTab } from "@/lib/leagues/registry";
import { snakeFantraxSeed } from "@/lib/snake/league-seed";
import type { SnakeSummaryFile } from "@/lib/snake/types";
import { categoryBoard, categorySnakeSeed } from "./category-board";
import {
  CategoryDraftPart,
  CategoryPlayersPart,
  CategoryTeamPart,
  FantraxDraftPart,
  FantraxHeaderPart,
  FantraxPlayersPart,
  FantraxShellPart,
  FantraxTeamPart,
  FantraxTodayPart,
  FantraxWaiversPart,
} from "./client-parts";

export interface ServerLeagueAdapter {
  kind: LeagueKind;
  /** Container width of the league header, tab bar and tab bodies. */
  widthClass: string;
  /** Tabs whose body is not wrapped in the width/padding (a full-width layout of its own). */
  fullBleedTabs: readonly LeagueTab[];
  /** Providers for every tab of the league (client boundary inside). */
  Shell(props: { entry: LeagueEntry; children: ReactNode }): ReactNode;
  /** The kind's block inside the league header. */
  Header(props: { entry: LeagueEntry }): ReactNode;
  /** One tab's body. */
  Tab(props: { entry: LeagueEntry; tab: LeagueTab }): ReactNode;
  /** Meta description of a tab page. */
  describe(entry: LeagueEntry, tab: LeagueTab): string;
  /** The line under a tab's h1 (the kind's own wording where the generic one would not be true). */
  lead(entry: LeagueEntry, tab: LeagueTab): string;
}

// ------------------------------------------------------------ fantrax-points

/**
 * Each Fantrax league's OWN baked snapshot, by slug (`src/lib/fantrax/baked.ts`).
 * Reading `@/data/fantrax/league.json` as a module constant here was the
 * single biggest hazard of adding a second Fantrax league: it would have shown
 * the Captains league's settings, teams and daily plan under the other
 * league's name.
 */
function FantraxShell({ entry, children }: { entry: LeagueEntry; children: ReactNode }) {
  const baked = fantraxBaked(entry.slug);
  // Server-rendered props stay small: the default team's plan (~10-14 KB) and
  // the team names. Everything else is fetched by the browser on demand.
  const teams = baked.league.teams
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr-CA"));
  const defaultTeamId = teams.some((t) => t.id === entry.myTeamId) ? entry.myTeamId : baked.today.teamId;
  return (
    <FantraxShellPart
      slug={entry.slug}
      initialPlan={baked.today}
      teams={teams}
      leagueName={baked.league.leagueName}
      limits={baked.league.limits}
      defaultTeamId={defaultTeamId}
      snakeSeed={snakeFantraxSeed(baked.today, summaryJson as unknown as SnakeSummaryFile)}
      hasDynasty={fantraxHasDynasty(entry.slug)}
    >
      {children}
    </FantraxShellPart>
  );
}

function FantraxTab({ entry, tab }: { entry: LeagueEntry; tab: LeagueTab }) {
  switch (tab) {
    case "aujourdhui":
      return <FantraxTodayPart slug={entry.slug} />;
    case "repechage":
      return <FantraxDraftPart slug={entry.slug} />;
    case "joueurs":
      return <FantraxPlayersPart slug={entry.slug} />;
    case "ballottage":
      return <FantraxWaiversPart />;
    case "mon-equipe":
      return <FantraxTeamPart slug={entry.slug} />;
    default:
      return null;
  }
}

/**
 * A tab's lead line. The generic one describes the Captains feature set, so a
 * league without a captain slot or without games caps gets its own wording
 * rather than a promise the page cannot keep.
 */
function fantraxLead(entry: LeagueEntry, tab: LeagueTab): string {
  const cfg = fantraxLeague(entry.slug);
  if (tab === "aujourdhui" && !cfg.features.captainSlot) {
    const parts = [
      cfg.salaryCap ? "Légalité et masse salariale" : "Légalité",
      `alignement optimal (${cfg.limits.maxActive} postes)`,
      "gardiens",
    ];
    if (cfg.features.gamesCaps) parts.push("plafonds");
    const range = cfg.cadence.scoringPeriodDaysRange;
    const duel = range ? `duels de ${range[0]} à ${range[1]} jours` : `duel de ${cfg.cadence.scoringPeriodDays} jours`;
    const lock =
      cfg.cadence.lock?.kind === "game"
        ? `; chaque joueur se verrouille ${cfg.cadence.lock.minutesBefore} minutes avant son match`
        : "";
    return `${parts.join(", ")}, ${duel}${lock}.`;
  }
  if (tab === "repechage" && cfg.salaryCap) {
    const s = Math.round((cfg.cadence.draftPollMs ?? 90_000) / 1000);
    return `Le repêchage en direct (relu toutes les ${s} secondes) : au tour de qui, vos choix, votre masse salariale et vos besoins par position, meilleurs disponibles en valeur dynastie.`;
  }
  if (tab === "mon-equipe" && cfg.salaryCap) {
    return "Votre effectif par statut, sa masse salariale saison par saison et qui envoyer aux mineures pour libérer de l’espace.";
  }
  return TAB_META[tab].description;
}

const FANTRAX_POINTS: ServerLeagueAdapter = {
  kind: "fantrax-points",
  widthClass: "max-w-[120rem]",
  fullBleedTabs: [],
  Shell: FantraxShell,
  Header: () => <FantraxHeaderPart />,
  Tab: FantraxTab,
  // The format is the league's, not the kind's (both Fantrax leagues are
  // « dynastie »; a keeper league would say « keeper »).
  // The same wording as the tab's own lead, so the meta description cannot
  // promise a captain or a games cap the league has not got.
  describe: (entry, tab) =>
    `${fantraxLead(entry, tab)} Ligue Fantrax ${entry.name} (${FORMAT_LABEL[entry.format].toLowerCase()}, points), outil non officiel en lecture seule.`,
  lead: (entry, tab) => fantraxLead(entry, tab),
};

// ------------------------------------------------------------ yahoo-categories

/** No shared client state yet: the draft lives in this browser's storage. */
function CategoryShell({ children }: { entry: LeagueEntry; children: ReactNode }) {
  return <>{children}</>;
}

function CategoryTab({ entry, tab }: { entry: LeagueEntry; tab: LeagueTab }) {
  // Board and Snake seed inlined per tab (not in the layout): only the tabs that show players carry them.
  switch (tab) {
    case "repechage":
      // The live draft helper, unchanged (same storage key), with Snake's chips.
      return <CategoryDraftPart board={categoryBoard(entry)} seed={categorySnakeSeed(entry)} />;
    case "joueurs":
      return (
        <CategoryPlayersTab
          board={categoryBoard(entry)}
          table={<CategoryPlayersPart board={categoryBoard(entry)} seed={categorySnakeSeed(entry)} />}
        />
      );
    case "mon-equipe":
      return <CategoryTeamPart board={categoryBoard(entry)} slug={entry.slug} seed={categorySnakeSeed(entry)} />;
    case "duel":
      return <CategoryDuelTab slug={entry.slug} />;
    default:
      return null;
  }
}

/** Joueurs lists the draft board, not every player: say how deep it goes. */
function categoryLead(entry: LeagueEntry, tab: LeagueTab): string {
  if (tab === "joueurs") {
    return `Les ${categoryBoard(entry).players.length} premiers joueurs de la liste du repêchage, valorisés pour les catégories de cette ligue : filtres, tris, colonnes.`;
  }
  return TAB_META[tab].description;
}

const YAHOO_CATEGORIES: ServerLeagueAdapter = {
  kind: "yahoo-categories",
  widthClass: "max-w-[120rem]",
  fullBleedTabs: ["repechage"],
  Shell: CategoryShell,
  Header: ({ entry }) => <CategoryLeagueHeader board={categoryBoard(entry)} />,
  Tab: CategoryTab,
  describe: (entry, tab) =>
    `${categoryLead(entry, tab)} Ligue Yahoo ${entry.name} (saison unique, têtes-à-têtes par catégories), outil non officiel.`,
  lead: categoryLead,
};

export const SERVER_ADAPTERS: Record<LeagueKind, ServerLeagueAdapter> = {
  "fantrax-points": FANTRAX_POINTS,
  "yahoo-categories": YAHOO_CATEGORIES,
};
