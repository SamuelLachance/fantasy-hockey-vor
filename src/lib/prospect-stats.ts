import { existsSync, readFileSync } from "fs";
import { join } from "path";

export interface ProspectSeasonRow {
  season: number;
  leagueAbbrev: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  shots?: number;
  pim?: number;
  gameTypeId: number;
}

export interface ProspectRates {
  goalsPerGame: number;
  assistsPerGame: number;
  shotsPerGame: number;
  pimPerGame: number;
  sourceLeagues: string[];
  nhlTranslationFactor: number;
}

/** NHL-equivalent scoring translation by league (goals/assists scale). */
const LEAGUE_NHL_FACTOR: Record<string, number> = {
  NHL: 1,
  AHL: 0.58,
  OHL: 0.28,
  WHL: 0.27,
  QMJHL: 0.26,
  NCAA: 0.32,
  USHL: 0.22,
  SHL: 0.48,
  Liiga: 0.45,
  KHL: 0.52,
  DEL: 0.42,
  NLA: 0.4,
  Extraliga: 0.38,
  Czechia: 0.4,
};

const CHL_PATTERN = /^(OHL|WHL|QMJHL)$/;

function leagueFactor(league: string): number {
  if (LEAGUE_NHL_FACTOR[league]) return LEAGUE_NHL_FACTOR[league];
  if (CHL_PATTERN.test(league)) return 0.27;
  if (league.includes("NCAA") || league === "NCAA") return 0.32;
  if (league.includes("AHL")) return 0.58;
  if (league.endsWith("HL") || league.includes("USHL")) return 0.24;
  return 0.3;
}

const PROSPECT_LEAGUES = new Set([
  "AHL",
  "OHL",
  "WHL",
  "QMJHL",
  "NCAA",
  "USHL",
  "SHL",
  "Liiga",
  "KHL",
  "DEL",
  "NLA",
  "WC",
  "WJC-20",
  "WJC-18",
]);

export function isProspectLeague(league: string): boolean {
  if (PROSPECT_LEAGUES.has(league)) return true;
  if (CHL_PATTERN.test(league)) return true;
  if (league.includes("NCAA")) return true;
  return leagueFactor(league) < 0.95 && league !== "NHL";
}

export function parseSeasonTotals(
  seasonTotals: unknown,
): ProspectSeasonRow[] {
  if (!Array.isArray(seasonTotals)) return [];
  const out: ProspectSeasonRow[] = [];
  for (const row of seasonTotals) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const league = String(r.leagueAbbrev ?? "");
    if (!isProspectLeague(league)) continue;
    if (Number(r.gameTypeId) !== 2) continue;
    const gp = Number(r.gamesPlayed ?? 0);
    if (gp < 10) continue;
    out.push({
      season: Number(r.season ?? 0),
      leagueAbbrev: league,
      gamesPlayed: gp,
      goals: Number(r.goals ?? 0),
      assists: Number(r.assists ?? 0),
      points: Number(r.points ?? Number(r.goals ?? 0) + Number(r.assists ?? 0)),
      shots: Number(r.shots ?? 0),
      pim: Number(r.pim ?? 0),
      gameTypeId: 2,
    });
  }
  return out.sort((a, b) => b.season - a.season);
}

export function prospectRatesFromSeasons(
  seasons: ProspectSeasonRow[],
  beforeSeasonId = 99_999_999,
): ProspectRates | null {
  const eligible = seasons.filter((s) => {
    const seasonId = s.season >= 1_000_000 ? s.season : s.season + 1_000_000;
    return seasonId < beforeSeasonId;
  });
  if (eligible.length === 0) return null;

  const recent = eligible.slice(0, 3);
  const weights = [0.55, 0.3, 0.15].slice(0, recent.length);
  const wSum = weights.reduce((a, b) => a + b, 0);

  let goalsPg = 0;
  let assistsPg = 0;
  let shotsPg = 0;
  let pimPg = 0;
  let factorSum = 0;
  const leagues = new Set<string>();

  for (let i = 0; i < recent.length; i++) {
    const s = recent[i];
    const w = weights[i] / wSum;
    const factor = leagueFactor(s.leagueAbbrev);
    leagues.add(s.leagueAbbrev);
    goalsPg += (s.goals / s.gamesPlayed) * factor * w;
    assistsPg += (s.assists / s.gamesPlayed) * factor * w;
    // `||` not `??`: leagues that don't report shots parse as 0, which must
    // fall back to the goals-based estimate instead of zeroing the blend.
    shotsPg += ((s.shots || s.goals * 2.5) / s.gamesPlayed) * factor * w;
    pimPg += ((s.pim ?? 0) / s.gamesPlayed) * w;
    factorSum += factor * w;
  }

  return {
    goalsPerGame: goalsPg,
    assistsPerGame: assistsPg,
    shotsPerGame: shotsPg,
    pimPerGame: pimPg,
    sourceLeagues: [...leagues],
    nhlTranslationFactor: factorSum,
  };
}

export interface ProspectCacheEntry {
  playerId: number;
  rates: ProspectRates;
  /** Raw eligible prospect seasons, kept for temporal filtering at lookup. */
  seasons?: ProspectSeasonRow[];
}

export interface ProspectCache {
  builtAt: string;
  entries: ProspectCacheEntry[];
}

let cache: Map<number, ProspectCacheEntry> | null = null;

const CACHE_PATH = join(process.cwd(), "src", "data", "prospect-stats.json");

export function loadProspectCache(): Map<number, ProspectCacheEntry> {
  if (cache) return cache;
  cache = new Map();
  if (!existsSync(CACHE_PATH)) return cache;
  try {
    const data = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as ProspectCache;
    for (const entry of data.entries ?? []) {
      cache.set(entry.playerId, entry);
    }
  } catch {
    cache = new Map();
  }
  return cache;
}

export function lookupProspectRates(
  playerId: number,
  beforeSeasonId?: number,
): ProspectRates | undefined {
  const entry = loadProspectCache().get(playerId);
  if (!entry) return undefined;
  // Honor the temporal cutoff when the cache carries raw seasons — otherwise
  // training examples for past seasons would blend in prospect years that
  // postdate the target season. Older caches without seasons fall back to
  // the aggregate rates.
  if (beforeSeasonId != null && entry.seasons?.length) {
    return prospectRatesFromSeasons(entry.seasons, beforeSeasonId) ?? undefined;
  }
  return entry.rates;
}
