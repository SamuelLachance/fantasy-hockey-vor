/**
 * Browser data layer for Captains Dynasty. The pages first paint the default team's
 * plan baked into `today.json`; this module then brings in everything the
 * browser needs to re-run `buildDailyPlan` for any team at the current time:
 *
 * - the baked snapshot (`public/fantrax/{values,state,schedule}.json`,
 *   fetched with the build-time cache buster, 8 s timeout, one retry: see
 *   `snapshot-fetch.ts`) plus league.json as a lazy JS chunk;
 * - live rosters and draft picks from fxea (CORS `*`, `credentials: "omit"`,
 *   no login), cached a couple of minutes in sessionStorage.
 *
 * Storage access is wrapped: private windows and blocked site data throw.
 */
import type { FxeaDraftResults, FxeaTeamRosters } from "./api-types";
import { fxeaGet } from "./client";
import { FANTRAX_LEAGUE_ID, NHL_SEASON_ID } from "./config";
import { liveOverlay, type LiveOverlay } from "./live";
import { fetchSnapshotFile } from "./snapshot-fetch";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "./snapshot-types";

export interface LeagueSnapshotBundle {
  league: LeagueSnapshot;
  state: StateSnapshot;
  values: ValuesSnapshot;
  schedule: ScheduleSnapshot;
}

let bundlePromise: Promise<LeagueSnapshotBundle> | null = null;

async function loadBundleOnce(): Promise<LeagueSnapshotBundle> {
  const [leagueModule, values, state, schedule] = await Promise.all([
    import("@/data/fantrax/league.json"),
    fetchSnapshotFile<ValuesSnapshot>("values.json"),
    fetchSnapshotFile<StateSnapshot>("state.json"),
    fetchSnapshotFile<ScheduleSnapshot>(`schedule-${NHL_SEASON_ID}.json`),
  ]);
  const league = (leagueModule.default ?? leagueModule) as unknown as LeagueSnapshot;
  if (!values?.players || !state?.rosters || !Array.isArray(schedule?.games)) {
    throw new Error("Fantrax snapshot is malformed");
  }
  return { league, state, values, schedule };
}

/** Baked snapshot, fetched once per page view; a failure can be retried. */
export function loadLeagueSnapshot(): Promise<LeagueSnapshotBundle> {
  if (!bundlePromise) {
    const p = loadBundleOnce().catch((err) => {
      if (bundlePromise === p) bundlePromise = null;
      throw err;
    });
    bundlePromise = p;
  }
  return bundlePromise;
}

// ------------------------------------------------------------ live fxea

/** Re-read Fantrax at most this often unless the user asks for a refresh. */
export const LIVE_CACHE_TTL_MS = 2 * 60_000;
/** Draft picks are polled this often while the draft runs and the tab is visible. */
export const LIVE_DRAFT_POLL_MS = 90_000;
const LIVE_CACHE_KEY = "fantrax-live:v1";

/** Cached overlay if it is for the same lineup period and still fresh. */
export function parseLiveCache(
  raw: string | null,
  nowMs: number,
  rosterPeriod: number,
  ttlMs = LIVE_CACHE_TTL_MS,
): LiveOverlay | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LiveOverlay;
    const age = nowMs - Date.parse(v.fetchedAt);
    if (!v.rosters || typeof v.rosters !== "object") return null;
    if (v.rosterPeriod !== rosterPeriod) return null;
    if (!Number.isFinite(age) || age < 0 || age > ttlMs) return null;
    return { ...v, recent: Array.isArray(v.recent) ? v.recent : [] };
  } catch {
    return null;
  }
}

function readSession(key: string): string | null {
  try {
    return globalThis.sessionStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    globalThis.sessionStorage?.setItem(key, value);
  } catch {
    // Quota / privacy mode: the overlay just is not cached.
  }
}

const BROWSER_REQUEST = { retries: 2, timeoutMs: 8_000 };

/**
 * Live rosters (fatal if unreadable) and draft picks (optional) for the
 * lineup period that locks next. Two GETs, >= 1 s apart (client throttle).
 */
export async function fetchLiveOverlay(
  rosterPeriod: number,
  opts: { force?: boolean } = {},
): Promise<LiveOverlay> {
  if (!opts.force) {
    const cached = parseLiveCache(readSession(LIVE_CACHE_KEY), Date.now(), rosterPeriod);
    if (cached) return cached;
  }
  const rosters = await fxeaGet<FxeaTeamRosters>(
    "getTeamRosters",
    { leagueId: FANTRAX_LEAGUE_ID, period: rosterPeriod },
    BROWSER_REQUEST,
  );
  const draft = await fxeaGet<FxeaDraftResults>(
    "getDraftResults",
    { leagueId: FANTRAX_LEAGUE_ID },
    BROWSER_REQUEST,
  ).catch(() => null);
  const overlay = liveOverlay(rosters, draft, Date.now(), rosterPeriod);
  writeSession(LIVE_CACHE_KEY, JSON.stringify(overlay));
  return overlay;
}

// ------------------------------------------------------------ team choice

const TEAM_STORAGE_KEY = "fantrax-team";

export function readStoredTeam(): string | null {
  try {
    return globalThis.localStorage?.getItem(TEAM_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function storeTeam(teamId: string): void {
  try {
    globalThis.localStorage?.setItem(TEAM_STORAGE_KEY, teamId);
  } catch {
    // Not remembered across visits; the URL still carries it.
  }
}

/** First candidate that is a team of this league, else the fallback. */
export function pickTeam(
  candidates: ReadonlyArray<string | null | undefined>,
  teams: ReadonlyArray<{ id: string }>,
  fallback: string,
): string {
  for (const c of candidates) {
    if (c && teams.some((t) => t.id === c)) return c;
  }
  return fallback;
}

/**
 * Query string for a team: none for the default team, `?team=<id>`
 * otherwise (other params are kept). No trailing slash is ever added:
 * `/league/` 404s on Pages.
 */
export function teamSearch(search: string, teamId: string, defaultTeamId: string): string {
  const params = new URLSearchParams(search);
  if (teamId === defaultTeamId) params.delete("team");
  else params.set("team", teamId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
