/**
 * Where a player spent each season: NHL games and games in every other
 * league (AHL, NCAA, CHL, SHL, KHL…), from the public NHL player landing
 * `seasonTotals` (regular season only).
 *
 * The NHL feeds the projection engine is built on only know NHL games, so a
 * 14-game NHL season reads the same whether the player spent 68 games on
 * injured reserve or 35 games at Boston University before he signed. This
 * cache tells the two apart: games a player spent in another league are not
 * games he missed (`src/lib/split-season.ts`).
 *
 * Built by `npm run collect:leagues` (scripts/build-league-seasons.ts) into
 * `src/data/league-seasons.json`, for every player of the ML history
 * (`src/data/ml/durability.json`) and of the current profiles.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

export const LEAGUE_SEASONS_PATH = join(
  process.cwd(),
  "src",
  "data",
  "league-seasons.json",
);

/** First season kept in the cache (older rows never feed a projection). */
export const LEAGUE_SEASONS_MIN_SEASON = 20002001;

/**
 * One league line: [seasonId, leagueAbbrev, gamesPlayed] or, for NHL lines,
 * [seasonId, "NHL", gamesPlayed, averageToiSeconds].
 */
export type LeagueSeasonLine =
  | [number, string, number]
  | [number, string, number, number];

export interface LeagueSeasonsPlayer {
  /** NHL position code from the landing (C, L, R, D, G). */
  pos: string;
  /** YYYY-MM-DD. */
  birth: string;
  /** Overall entry-draft pick, null when undrafted. */
  draft: number | null;
  draftYear: number | null;
  seasons: LeagueSeasonLine[];
}

export interface LeagueSeasonsCache {
  builtAt: string;
  source: string;
  /** NHL id → player; null when the landing was not found. */
  players: Record<string, LeagueSeasonsPlayer | null>;
}

/**
 * International events and exhibitions: short tournaments, mostly played
 * outside the NHL calendar (World Championship in May) or a week long (WJC).
 * They never stand for a season spent away from the NHL.
 */
const NON_CLUB_LEAGUES = new Set([
  "WC",
  "WC-A",
  "WC-B",
  "WJC-20",
  "WJC-A",
  "WJC-B",
  "WJC-18",
  "WJC18-A",
  "WJ18-A",
  "WJ18",
  "WHC-17",
  "U-17",
  "U-18",
  "OG",
  "OGQ",
  "Olympics",
  "WCup",
  "WCH",
  "4 Nations",
  "4NF",
  "Hlinka",
  "Exhib.",
  "Other",
  "Spengler Cup",
  "Champions HL",
  "Memorial Cup",
  "M-Cup",
  "EHT",
  "DHL Cup",
  "International",
  "International-Jr",
]);

export function isClubLeague(league: string): boolean {
  if (!league || league === "NHL") return false;
  if (NON_CLUB_LEAGUES.has(league)) return false;
  if (/^(WJC|WJ18|WC|WHC|OG)\b/.test(league)) return false;
  return true;
}

/** "17:27" → 1047 seconds. */
export function toiToSeconds(toi: unknown): number {
  if (typeof toi === "number" && Number.isFinite(toi)) return toi;
  if (typeof toi !== "string") return 0;
  const m = /^(\d+):(\d{2})$/.exec(toi.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/**
 * Collapse a landing's `seasonTotals` into one line per season and league
 * (regular season only; NHL lines carry the GP-weighted average TOI).
 */
export function parseLeagueSeasonTotals(
  seasonTotals: unknown,
  minSeason = LEAGUE_SEASONS_MIN_SEASON,
): LeagueSeasonLine[] {
  if (!Array.isArray(seasonTotals)) return [];
  const byKey = new Map<
    string,
    { season: number; league: string; gp: number; toiGp: number }
  >();
  for (const row of seasonTotals) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (Number(r.gameTypeId) !== 2) continue;
    const season = Number(r.season);
    if (!Number.isFinite(season) || season < minSeason) continue;
    const league = String(r.leagueAbbrev ?? "").trim();
    const gp = Number(r.gamesPlayed ?? 0);
    if (!league || !(gp > 0)) continue;
    const key = `${season}|${league}`;
    const agg = byKey.get(key) ?? { season, league, gp: 0, toiGp: 0 };
    agg.gp += gp;
    if (league === "NHL") agg.toiGp += toiToSeconds(r.avgToi) * gp;
    byKey.set(key, agg);
  }
  return [...byKey.values()]
    .sort(
      (a, b) =>
        a.season - b.season ||
        (a.league === "NHL" ? -1 : b.league === "NHL" ? 1 : a.league.localeCompare(b.league)),
    )
    .map((a) =>
      a.league === "NHL"
        ? ([a.season, "NHL", a.gp, a.gp > 0 ? Math.round(a.toiGp / a.gp) : 0] as LeagueSeasonLine)
        : ([a.season, a.league, a.gp] as LeagueSeasonLine),
    );
}

/** Games a player dressed for in club leagues other than the NHL in a season. */
export function otherLeagueGamesIn(
  player: Pick<LeagueSeasonsPlayer, "seasons"> | null | undefined,
  seasonId: number,
): { games: number; leagues: string[] } {
  if (!player) return { games: 0, leagues: [] };
  let games = 0;
  const leagues: string[] = [];
  for (const [season, league, gp] of player.seasons) {
    if (season !== seasonId || !isClubLeague(league)) continue;
    games += gp;
    if (!leagues.includes(league)) leagues.push(league);
  }
  return { games, leagues };
}

/** NHL games and average TOI (seconds) in a season, from the cache. */
export function nhlGamesIn(
  player: Pick<LeagueSeasonsPlayer, "seasons"> | null | undefined,
  seasonId: number,
): { games: number; toiSeconds: number } {
  if (!player) return { games: 0, toiSeconds: 0 };
  for (const line of player.seasons) {
    if (line[0] === seasonId && line[1] === "NHL") {
      return { games: line[2], toiSeconds: line[3] ?? 0 };
    }
  }
  return { games: 0, toiSeconds: 0 };
}

let cache: LeagueSeasonsCache | null | undefined;

export function loadLeagueSeasonsSync(
  path = LEAGUE_SEASONS_PATH,
): LeagueSeasonsCache | null {
  if (path === LEAGUE_SEASONS_PATH && cache !== undefined) return cache;
  let loaded: LeagueSeasonsCache | null = null;
  if (existsSync(path)) {
    try {
      loaded = JSON.parse(readFileSync(path, "utf8")) as LeagueSeasonsCache;
    } catch {
      loaded = null;
    }
  }
  if (path === LEAGUE_SEASONS_PATH) cache = loaded;
  return loaded;
}
