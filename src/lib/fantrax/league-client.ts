/**
 * Browser data layer of a Fantrax points league. The pages first paint the
 * default team's plan baked into that league's `today.json`; this module then
 * brings in everything the browser needs to re-run `buildDailyPlan` for any
 * team at the current time:
 *
 * - the baked snapshot (`<public>/{values,state,schedule}.json`, fetched with
 *   the build-time cache buster, 8 s timeout, one retry: see
 *   `snapshot-fetch.ts`) plus that league's league.json as a lazy JS chunk;
 * - live rosters and draft picks from fxea (CORS `*`, `credentials: "omit"`,
 *   no login), cached a couple of minutes in sessionStorage.
 *
 * EVERYTHING here is keyed by the league's config: the module-level promise
 * caches, the sessionStorage overlay and the remembered team. Two Fantrax
 * leagues live in one single-page session, so a cache shared between them
 * would show one league's rosters under the other league's name.
 *
 * Storage access is wrapped: private windows and blocked site data throw.
 */
import type { FxeaDraftResults, FxeaTeamRosters } from "./api-types";
import { fxeaGet } from "./client";
import {
  CAPTAINS_DYNASTY,
  fantraxPublicFile,
  fantraxScheduleFile,
  type FantraxLeagueConfig,
} from "./config";
import { liveOverlay, type LiveOverlay } from "./live";
import { isContractsFile, type ContractsFile } from "./salary-cap";
import { fetchOptionalJson, fetchSnapshotFile } from "./snapshot-fetch";
import { fantraxDataHref } from "@/lib/site";
import type {
  DynastySnapshot,
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
  /**
   * A salary-cap league's contracts (`<public>/contracts.json`, derived from
   * its dynasty.json at build time); null elsewhere, or when unreadable (the
   * plan then has no cap line rather than failing).
   */
  contracts: ContractsFile | null;
}

/**
 * `league.json` of each league as a lazy chunk. The import specifiers must be
 * literals for the bundler to find the files at all, so a new league adds a
 * line here (`check:league` fails when its files are missing).
 */
const LEAGUE_JSON: Record<string, () => Promise<{ default?: unknown }>> = {
  "captains-dynasty": () => import("@/data/fantrax/league.json"),
  slapshot: () => import("@/data/fantrax/slapshot/league.json"),
};

async function loadBundleOnce(cfg: FantraxLeagueConfig): Promise<LeagueSnapshotBundle> {
  const loadLeagueJson = LEAGUE_JSON[cfg.slug];
  if (!loadLeagueJson) throw new Error(`no league.json chunk for ${cfg.slug}`);
  const file = (name: string) => fantraxPublicFile(cfg, name);
  const [leagueModule, values, state, schedule, contracts] = await Promise.all([
    loadLeagueJson(),
    fetchSnapshotFile<ValuesSnapshot>(file("values.json")),
    fetchSnapshotFile<StateSnapshot>(file("state.json")),
    fetchSnapshotFile<ScheduleSnapshot>(file(fantraxScheduleFile(cfg))),
    cfg.salaryCap
      ? fetchOptionalJson(fantraxDataHref(file("contracts.json"))).then((c) => (isContractsFile(c) ? c : null))
      : Promise.resolve(null),
  ]);
  const league = (leagueModule.default ?? leagueModule) as unknown as LeagueSnapshot;
  if (!values?.players || !state?.rosters || !Array.isArray(schedule?.games)) {
    throw new Error("Fantrax snapshot is malformed");
  }
  if (league.leagueId !== cfg.leagueId) {
    // A wrong chunk would show another league's settings under this name.
    throw new Error(`league.json is league ${league.leagueId}, expected ${cfg.leagueId}`);
  }
  return { league, state, values, schedule, contracts };
}

const bundlePromises = new Map<string, Promise<LeagueSnapshotBundle>>();

/** Baked snapshot of one league, fetched once per page view; retryable. */
export function loadLeagueSnapshot(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): Promise<LeagueSnapshotBundle> {
  const cached = bundlePromises.get(cfg.slug);
  if (cached) return cached;
  const p = loadBundleOnce(cfg).catch((err) => {
    if (bundlePromises.get(cfg.slug) === p) bundlePromises.delete(cfg.slug);
    throw err;
  });
  bundlePromises.set(cfg.slug, p);
  return p;
}

// ------------------------------------------------------------ dynasty

let dynastyPromise: Promise<DynastySnapshot | null> | null = null;

/**
 * public/fantrax/dynasty.json (npm run dynasty:build), fetched once per page
 * view. Optional: a missing or malformed file gives null and the page keeps
 * its season-only behaviour. Only the Captains league has one: a league
 * without the keeper model must never publish it (`check:league` fails on
 * that), so this stays on the Captains path.
 */
export function loadDynastySnapshot(): Promise<DynastySnapshot | null> {
  if (!dynastyPromise) {
    dynastyPromise = fetchSnapshotFile<DynastySnapshot>(fantraxPublicFile(CAPTAINS_DYNASTY, "dynasty.json"))
      .then((d) => (d && d.version === 1 && d.players && typeof d.players === "object" ? d : null))
      .catch(() => null);
  }
  return dynastyPromise;
}

// ------------------------------------------------------------ live fxea

/** Re-read Fantrax at most this often unless the user asks for a refresh. */
export const LIVE_CACHE_TTL_MS = 2 * 60_000;
/** Draft picks are polled this often while the draft runs and the tab is visible (a league may poll faster: `cadence.draftPollMs`). */
export const LIVE_DRAFT_POLL_MS = 90_000;

/** The live-draft poll of one league. */
export function draftPollMs(cfg: FantraxLeagueConfig): number {
  return cfg.cadence.draftPollMs ?? LIVE_DRAFT_POLL_MS;
}
const liveCacheKey = (cfg: FantraxLeagueConfig) => `fantrax-live:v1:${cfg.slug}`;

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
 * lineup period that locks next. Two GETs, >= 1.1 s apart (client throttle).
 */
export async function fetchLiveOverlay(
  rosterPeriod: number,
  opts: { force?: boolean; config?: FantraxLeagueConfig } = {},
): Promise<LiveOverlay> {
  const cfg = opts.config ?? CAPTAINS_DYNASTY;
  const key = liveCacheKey(cfg);
  if (!opts.force) {
    const cached = parseLiveCache(readSession(key), Date.now(), rosterPeriod);
    if (cached) return cached;
  }
  const rosters = await fxeaGet<FxeaTeamRosters>(
    "getTeamRosters",
    { leagueId: cfg.leagueId, period: rosterPeriod },
    BROWSER_REQUEST,
  );
  const draft = await fxeaGet<FxeaDraftResults>(
    "getDraftResults",
    { leagueId: cfg.leagueId },
    BROWSER_REQUEST,
  ).catch(() => null);
  const overlay = liveOverlay(rosters, draft, Date.now(), rosterPeriod);
  writeSession(key, JSON.stringify(overlay));
  return overlay;
}

// ------------------------------------------------------------ team choice

/**
 * The team last looked at, per league. Captains keeps the historical key so
 * nobody loses the team they had picked; another league gets its own, since a
 * team id of one league means nothing in another.
 */
const teamStorageKey = (cfg: FantraxLeagueConfig) =>
  cfg.slug === CAPTAINS_DYNASTY.slug ? "fantrax-team" : `fantrax-team:${cfg.slug}`;

export function readStoredTeam(cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): string | null {
  try {
    return globalThis.localStorage?.getItem(teamStorageKey(cfg)) ?? null;
  } catch {
    return null;
  }
}

export function storeTeam(teamId: string, cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY): void {
  try {
    globalThis.localStorage?.setItem(teamStorageKey(cfg), teamId);
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
