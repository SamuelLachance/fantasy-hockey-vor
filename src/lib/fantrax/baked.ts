/**
 * Server-only access to a Fantrax league's BAKED snapshot, by registry slug.
 *
 * Every league has its own `league.json` and `today.json` (see
 * `FantraxPathConfig`), so nothing that renders a league may import one
 * league's file as a module constant — that is exactly how a second Fantrax
 * league would end up showing the first one's teams, limits and daily plan
 * under its own name. Ask here instead, with the slug in hand.
 *
 * The import specifiers are literals so the build tracer and the bundler both
 * see the files; adding a league adds a line. Reading them as JSON modules
 * (not `readFileSync`) keeps them in the build graph, so a stale or missing
 * file is a build error rather than a runtime surprise.
 */
import { existsSync } from "fs";
import { join } from "path";
import captainsLeague from "@/data/fantrax/league.json";
import captainsToday from "@/data/fantrax/today.json";
import slapshotLeague from "@/data/fantrax/slapshot/league.json";
import slapshotToday from "@/data/fantrax/slapshot/today.json";
import { fantraxLeague } from "./config";
import type { DailyPlan } from "./daily-plan";
import type { LeagueSnapshot } from "./snapshot-types";

export interface FantraxBaked {
  /** Settings, slots, limits, periods and teams, as the last sync read them. */
  league: LeagueSnapshot;
  /** The default team's plan at sync time: the first paint, no JavaScript needed. */
  today: DailyPlan;
}

/** Baked by `npm run league:sync -- --league <slug>` (the daily Action re-runs it). */
const BAKED: Record<string, FantraxBaked> = {
  "captains-dynasty": {
    league: captainsLeague as unknown as LeagueSnapshot,
    today: captainsToday as unknown as DailyPlan,
  },
  slapshot: {
    league: slapshotLeague as unknown as LeagueSnapshot,
    today: slapshotToday as unknown as DailyPlan,
  },
};

/**
 * One league's baked snapshot. Throws on a slug with no baked data, rather
 * than falling back to another league's — a wrong league on the page is worse
 * than a build failure.
 */
export function fantraxBaked(slug: string): FantraxBaked {
  const baked = BAKED[slug];
  if (!baked) {
    throw new Error(`no baked Fantrax snapshot for "${slug}" — run npm run league:sync -- --league ${slug}`);
  }
  const cfg = fantraxLeague(slug);
  if (baked.league.leagueId !== cfg.leagueId) {
    throw new Error(
      `${slug}: baked league.json is league ${baked.league.leagueId}, config says ${cfg.leagueId}`,
    );
  }
  return baked;
}

/**
 * The build can see this league's `dynasty.json`. False for a league whose
 * config has no keeper model — it must never publish one (`check:league`
 * fails on that), and without the file the browser never asks for it, so
 * every dynasty column, filter, preset and home line stays off.
 */
export function fantraxHasDynasty(slug: string): boolean {
  const cfg = fantraxLeague(slug);
  if (!cfg.features.dynasty) return false;
  return existsSync(join(process.cwd(), ...cfg.paths.public.split("/"), "dynasty.json"));
}
