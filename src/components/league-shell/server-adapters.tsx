/**
 * Server side of each kind of league: the providers every tab shares (held
 * by the league layout, so they survive tab changes), the kind's block in
 * the league header, and each tab's body. Server components: they read the
 * committed data at build time and hand baked props to the client pieces
 * (`client-parts.tsx`, one chunk each, so a page only loads its own kind
 * and tab). The home page does not come through here (see
 * `src/lib/leagues/home-data.ts`).
 */
import { existsSync } from "fs";
import { join } from "path";
import type { ReactNode } from "react";
import { CategoryDuelTab } from "@/components/draft/CategoryDuelTab";
import { CategoryLeagueHeader } from "@/components/draft/CategoryLeagueHeader";
import { CategoryPlayersTab } from "@/components/draft/CategoryPlayersTab";
import leagueJson from "@/data/fantrax/league.json";
import todayJson from "@/data/fantrax/today.json";
import summaryJson from "@/data/snake-summary.json";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import type { LeagueSnapshot } from "@/lib/fantrax/snapshot-types";
import { TAB_META, type LeagueEntry, type LeagueKind, type LeagueTab } from "@/lib/leagues/registry";
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

// Baked by `npm run league:sync` (the daily Action re-runs it before each build).
const fantraxLeague = leagueJson as unknown as LeagueSnapshot;
const fantraxToday = todayJson as unknown as DailyPlan;
// Dynasty values (no pipeline publishes them yet): without the file at
// build time, the browser never asks for it.
const hasDynasty = existsSync(join(process.cwd(), "public", "fantrax", "dynasty.json"));

function FantraxShell({ entry, children }: { entry: LeagueEntry; children: ReactNode }) {
  // Server-rendered props stay small: the default team's plan (~14 KB) and
  // the team names. Everything else is fetched by the browser on demand.
  const teams = fantraxLeague.teams
    .map((t) => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr-CA"));
  const defaultTeamId = teams.some((t) => t.id === entry.myTeamId) ? entry.myTeamId : fantraxToday.teamId;
  return (
    <FantraxShellPart
      initialPlan={fantraxToday}
      teams={teams}
      leagueName={fantraxLeague.leagueName}
      limits={fantraxLeague.limits}
      defaultTeamId={defaultTeamId}
      snakeSeed={snakeFantraxSeed(fantraxToday, summaryJson as unknown as SnakeSummaryFile)}
      hasDynasty={hasDynasty}
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
      return <FantraxPlayersPart />;
    case "ballottage":
      return <FantraxWaiversPart />;
    case "mon-equipe":
      return <FantraxTeamPart />;
    default:
      return null;
  }
}

const FANTRAX_POINTS: ServerLeagueAdapter = {
  kind: "fantrax-points",
  widthClass: "max-w-6xl",
  fullBleedTabs: [],
  Shell: FantraxShell,
  Header: () => <FantraxHeaderPart />,
  Tab: FantraxTab,
  describe: (entry, tab) =>
    `${TAB_META[tab].description} Ligue Fantrax ${entry.name} (dynastie, points), outil non officiel en lecture seule.`,
  lead: (_entry, tab) => TAB_META[tab].description,
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
  widthClass: "max-w-[96rem]",
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
