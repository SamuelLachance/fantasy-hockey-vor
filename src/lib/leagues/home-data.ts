/**
 * Server-only data of the « Mes ligues » page: the committed JSON of each
 * registry league through the pure builders of `home-summary.ts`. Kept
 * apart from the league pages' adapters so the home page never pulls
 * Fantrax or player-table client code.
 */
import { readFileSync } from "fs";
import { join } from "path";
import todayJson from "@/data/fantrax/today.json";
import summaryJson from "@/data/snake-summary.json";
import type { DailyPlan } from "@/lib/fantrax/daily-plan";
import { teamDynastySummary, type TeamDynastySummary } from "@/lib/fantrax/dynasty-hints";
import { parseDynasty } from "@/lib/fantrax/dynasty-index";
import { formatDateFr } from "@/lib/draft/draft-copy";
import { projectionAgeDays } from "@/lib/projection-age";
import { plural } from "@/lib/fantrax/league-copy";
import {
  categoryHomeCard,
  fantraxHomeCard,
  snakeHomeCard,
  type HomeCardData,
  type SnakeHomeData,
} from "./home-summary";
import { LEAGUES, type LeagueEntry } from "./registry";

export interface HomeLeague {
  entry: LeagueEntry;
  card: HomeCardData;
  /** yahoo-categories: what the device-local draft summary needs. */
  local: { slug: string; leagueSlug: string; teams: number; rounds: number; startsAt: string } | null;
}

/** `src/data/leagues/<slug>.json` (paths stay statically scoped for the build tracer). */
function readProfile<T>(slug: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "src", "data", "leagues", `${slug}.json`), "utf8")) as T;
}

/** `public/leagues/<slug>/board.json`. */
function readBoard<T>(slug: string): T {
  return JSON.parse(readFileSync(join(process.cwd(), "public", "leagues", slug, "board.json"), "utf8")) as T;
}

/**
 * My roster's 2027 cutdown outlook from the committed dynasty.json and
 * state.json (the same sync); null when either is missing or unreadable.
 */
function captainsDynasty(teamId: string): TeamDynastySummary | null {
  try {
    const dir = join(process.cwd(), "public", "fantrax");
    const index = parseDynasty(JSON.parse(readFileSync(join(dir, "dynasty.json"), "utf8")));
    const state = JSON.parse(readFileSync(join(dir, "state.json"), "utf8")) as { rosters?: Record<string, Array<{ id: string }>> };
    const roster = state.rosters?.[teamId];
    if (!index || !roster?.length) return null;
    return teamDynastySummary(roster.map((e) => index.byFantrax.get(e.id) ?? null));
  } catch {
    return null;
  }
}

interface ProfileJson {
  teams: number;
  draft: { startsAt: string; rounds: number; pickSeconds: number };
}

export function homeLeagues(): HomeLeague[] {
  return LEAGUES.map((entry): HomeLeague => {
    if (entry.kind === "fantrax-points") {
      const plan = todayJson as unknown as DailyPlan;
      return { entry, card: fantraxHomeCard(entry, plan, captainsDynasty(entry.myTeamId)), local: null };
    }
    const profile = readProfile<ProfileJson>(entry.profileSlug ?? entry.slug);
    return {
      entry,
      card: categoryHomeCard(entry, profile),
      local: {
        slug: entry.profileSlug ?? entry.slug,
        leagueSlug: entry.slug,
        teams: profile.teams,
        rounds: profile.draft.rounds,
        startsAt: profile.draft.startsAt,
      },
    };
  });
}

export function homeSnake(): SnakeHomeData {
  return snakeHomeCard(summaryJson as unknown as { stats: { players: number; opinions: number; lastDate: string } });
}

/** « Projections du 11 août 2026 (il y a 45 jours) », from the committed board of a categories league. */
export function homeProjectionLine(): string | null {
  const entry = LEAGUES.find((l) => l.kind === "yahoo-categories");
  if (!entry) return null;
  try {
    const board = readBoard<{ source?: { projectionsGeneratedAt?: string } }>(entry.profileSlug ?? entry.slug);
    const at = board.source?.projectionsGeneratedAt;
    if (!at) return null;
    const days = Math.floor(projectionAgeDays(at, process.env.NEXT_PUBLIC_BUILD_TIME));
    return `Projections LNH du ${formatDateFr(at)} (${days < 1 ? "aujourd’hui" : `il y a ${days} ${plural(days, "jour", "jours")}`})`;
  } catch {
    return null;
  }
}
