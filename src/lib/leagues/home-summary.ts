/**
 * « Mes ligues » cards (pure): what each league needs today, built from
 * the data baked at the last sync. Every baked line is dated by the card
 * (« À la synchro du … »), so a stale « dans 3 choix » never reads as live.
 */
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import {
  alertText,
  fmtDateTime,
  fmtDay,
  fmtTime,
  fmtZone,
  legalitySummary,
  ordinal,
  pickLabel,
} from "@/lib/fantrax/league-copy";
import { formatDraftStartFr } from "@/lib/draft/draft-copy";
import { DRAFT_DONE_AFTER_MS } from "@/lib/draft/draft-done";
import { formatCountFr, formatSnakeDate } from "@/lib/snake/copy";
import { SCORING_TITLE, TAB_META, leagueChips, type LeagueEntry, type LeagueTab } from "./registry";

export interface HomeAlert {
  level: "error" | "warn" | "info";
  text: string;
  /** The tab that deals with it (and a section of it). */
  tab: LeagueTab;
  hash?: string;
}

export interface HomeDate {
  label: string;
  iso: string;
  /** Static French wording (the countdown is added in the browser). */
  text: string;
  /** Countdown word once the moment has passed. */
  pastLabel: string;
  /** After this instant (ISO), `endLabel` replaces `pastLabel` (a draft that is over). */
  endIso?: string;
  endLabel?: string;
}

export interface HomeCardData {
  slug: string;
  title: string;
  chips: string[];
  /** Full meaning of the scoring chip. */
  scoringTitle: string;
  myTeam: string | null;
  /** When the baked lines were read (ISO), null when the card has none. */
  syncedAt: string | null;
  syncedText: string | null;
  alerts: HomeAlert[];
  dates: HomeDate[];
  tabs: Array<{ tab: LeagueTab; label: string }>;
  defaultTab: LeagueTab;
  /**
   * Query every link of the card carries (`?team=<my team>` for Fantrax:
   * the alerts are about the user's team, whatever team was last looked at
   * on this device).
   */
  search: string;
  externalUrl: string | null;
  platform: LeagueEntry["platform"];
  accent: LeagueEntry["accent"];
}

function baseCard(entry: LeagueEntry): Omit<HomeCardData, "myTeam" | "syncedAt" | "syncedText" | "alerts" | "dates" | "search"> {
  return {
    slug: entry.slug,
    title: entry.name,
    chips: leagueChips(entry),
    scoringTitle: SCORING_TITLE[entry.scoring],
    tabs: entry.tabs.map((tab) => ({ tab, label: TAB_META[tab].label })),
    defaultTab: entry.defaultTab,
    externalUrl: entry.externalUrl,
    platform: entry.platform,
    accent: entry.accent,
  };
}

/** « mar. 29 sept., 17 h 00 (HAE) » */
function lockText(iso: string): string {
  return `${fmtDay(iso)}, ${fmtTime(iso)} (${fmtZone(iso)})`;
}

type FantraxHomePlan = Pick<DailyPlan, "teamName" | "dataAsOf" | "legality" | "alerts" | "draft" | "target" | "players">;

/** The Fantrax points league: roster legality, empty slots, the live draft, the next lock. */
export function fantraxHomeCard(entry: LeagueEntry, plan: FantraxHomePlan): HomeCardData {
  const name = (id: string | null | undefined) => (id ? plan.players[id]?.n : undefined) ?? "Un joueur";
  const alerts: HomeAlert[] = [];
  if (plan.legality.illegal || plan.legality.need > 0) {
    alerts.push({ level: "error", text: legalitySummary(plan.legality), tab: "aujourdhui", hash: "alertes" });
  }
  const empty: string[] = [];
  for (const a of plan.alerts) {
    if (a.code === "illegal-roster") continue;
    const text = alertText(a, name);
    if (!text) continue;
    if (a.code === "empty-slot") {
      empty.push(text.replace(/\.$/, ""));
      continue;
    }
    alerts.push({ level: a.level, text, tab: "aujourdhui", hash: "alertes" });
  }
  if (empty.length > 0) {
    alerts.push({ level: "warn", text: `${empty.join(" · ")}.`, tab: "aujourdhui", hash: "alignement" });
  }
  const d = plan.draft;
  if (d && d.state === "running") {
    // Baked at the sync: the time sits in the line itself (picks move fast),
    // and the draft comes first while it runs.
    const myTurn = !!d.current && !!d.next && d.current.pick === d.next.pick;
    const at = `À ${fmtTime(plan.dataAsOf)}`;
    const text = !d.next
      ? "Repêchage en cours : vous n’avez plus de choix."
      : myTurn
        ? `Repêchage en cours. ${at}, c’était votre tour (choix ${pickLabel(d.next.pick)}, ${ordinal(d.next.round)} ronde) : suivez-le en direct.`
        : `Repêchage en cours. ${at}, votre choix ${pickLabel(d.next.pick)} était dans ${d.picksBefore} choix : suivez-le en direct.`;
    alerts.unshift({ level: myTurn ? "warn" : "info", text, tab: "repechage" });
  } else if (d && d.state === "not-started") {
    alerts.push({ level: "info", text: "Le repêchage de la ligue n’a pas encore commencé.", tab: "repechage" });
  }
  const dates: HomeDate[] = plan.target
    ? [{ label: "Prochain verrouillage", iso: plan.target.start, text: lockText(plan.target.start), pastLabel: "verrouillé" }]
    : [];
  return {
    ...baseCard(entry),
    search: `?team=${encodeURIComponent(entry.myTeamId)}`,
    myTeam: plan.teamName,
    syncedAt: plan.dataAsOf,
    syncedText: `À la synchro du ${fmtDateTime(plan.dataAsOf)}`,
    alerts,
    dates,
  };
}

interface CategoryHomeProfile {
  draft: { startsAt: string; rounds: number; pickSeconds: number };
}

/**
 * A Yahoo categories league: its draft date (the draft state itself lives
 * on this device), « terminé » once the draft is over by the clock.
 */
export function categoryHomeCard(entry: LeagueEntry, profile: CategoryHomeProfile): HomeCardData {
  const start = Date.parse(profile.draft.startsAt);
  const endIso = Number.isFinite(start) ? new Date(start + DRAFT_DONE_AFTER_MS).toISOString() : undefined;
  return {
    ...baseCard(entry),
    search: "",
    myTeam: null,
    syncedAt: null,
    syncedText: null,
    alerts: [],
    dates: [
      {
        label: "Repêchage",
        iso: profile.draft.startsAt,
        text: formatDraftStartFr(profile.draft.startsAt),
        pastLabel: "commencé",
        endIso,
        endLabel: "terminé",
      },
    ],
  };
}

export interface SnakeHomeData {
  players: string;
  opinions: string;
  lastDate: string;
  text: string;
}

/** « 1 272 joueurs · 9 255 opinions · dernier épisode 24 sept. 2026 » */
export function snakeHomeCard(summary: { stats: { players: number; opinions: number; lastDate: string } }): SnakeHomeData {
  const s = summary.stats;
  const players = `${formatCountFr(s.players)} joueurs`;
  const opinions = `${formatCountFr(s.opinions)} opinions`;
  const lastDate = formatSnakeDate(s.lastDate);
  return { players, opinions, lastDate, text: `${players} · ${opinions} · dernier épisode le ${lastDate}` };
}
