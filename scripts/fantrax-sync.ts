/**
 * Pulls one Fantrax league's state and bakes its snapshot:
 * <data>/{league,nhl-ids,today,prospect-pool}.json and
 * <public>/{values,state,pool,schedule-20262027}.json, then — only for a
 * league whose config enables the dynasty model — rebuilds its dynasty
 * values <public>/dynasty.json (scripts/dynasty-inputs.ts, ~15 s; skip with
 * --no-dynasty). Which league, where its files live, its slot table, its
 * scoring source, its roster limits and which of caps / minors / captain /
 * dynasty it even has all come from `src/lib/fantrax/config.ts`.
 *
 * Read-only and unauthenticated: fxea (public Beta API) for settings,
 * rosters, draft, ids and ADP; two batched fxpa POSTs for caps, injury /
 * minors flags, Ros% and claims, plus one for the minors-eligible prospects
 * the explorer pool lists; NHL api-web for the schedule and the picks of
 * the recent entry drafts. Fantrax
 * requests are >= 1 s apart with a descriptive User-Agent. If fxpa fails the
 * sync still writes everything with `state.fxpaOk = false`; if fxea fails it
 * exits non-zero and leaves the committed snapshot untouched. A league whose
 * config says fxpa is closed (`features.fxpa: false`) never calls it and
 * degrades the same way.
 *
 * Run: npm run league:sync [-- --league <slug>] [-- --full-schedule]
 *        [-- --team <teamId>] [-- --no-dynasty]
 * Default league: Captains Dynasty, with exactly the paths and settings it
 * has always had.
 */
import { existsSync, readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import type {
  FxeaAdpRow,
  FxeaDraftResults,
  FxeaLeagueInfo,
  FxeaPlayerIds,
  FxeaStandingsRow,
  FxeaTeamRosters,
  FxpaMessage,
  FxpaPlayerStatsData,
  FxpaTeamRosterInfoData,
  FxpaTransactionHistoryData,
  NhlScheduleWeek,
} from "../src/lib/fantrax/api-types";
import { fxeaGet, fxeaPost, fxpaPost } from "../src/lib/fantrax/client";
import {
  FANTRAX_ICON,
  FANTRAX_NO_TEAM,
  SYNC_USER_AGENT,
  type SlotId,
} from "../src/lib/fantrax/config";
import { fantraxLeagueArg, fantraxPaths } from "./fantrax-paths";
import { buildDailyPlan, indexSchedule, lineupTarget, seasonFp } from "../src/lib/fantrax/daily-plan";
import { leagueVor } from "../src/lib/fantrax/points-vor";
import {
  addDays,
  claimWeekStart,
  scoringPeriodAt,
  targetRosterPeriod,
  toIsoPeriods,
  torontoDate,
} from "../src/lib/fantrax/dates";
import { draftFromFxea, rostersFromFxea } from "../src/lib/fantrax/live";
import {
  fantraxDisplayName,
  groupOfPosition,
  groupsFromEligible,
  matchFantraxToNhl,
  type FantraxMatchPlayer,
  type NhlMatchCandidate,
} from "../src/lib/fantrax/match";
import { attachGoalieStartShares, valueRecord } from "../src/lib/fantrax/values-build";
import { buildPool, RECENT_NHL_DRAFTS, type PoolDraftPick, type PoolFlags } from "../src/lib/fantrax/pool";
import { scoringShape, scoringTableFromInfo, unscoredCategories } from "../src/lib/fantrax/scoring";
import type {
  CapUsage,
  LeagueSnapshot,
  NhlIdsSnapshot,
  ProspectPoolSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValueRecord,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";
import { fetchJson } from "../src/lib/nhl-api";
import { dynastyPaths, loadDynastyFiles, runDynastyBuild } from "./dynasty-inputs";
import { writeClientDynasty } from "./dynasty-client";
import { runSlapshotBuild, slapshotChecks, slapshotPaths } from "./dynasty-slapshot";
import { slapshotPoolFrom, writeSlapshotPool } from "./slapshot-sync";
import { buildSlapshotDraftPage } from "./build-slapshot-draft-page";
import type { ContractsFile } from "../src/lib/fantrax/salary-cap";
import type { PlayerProfile } from "../src/lib/profile-types";
import { normalizeTeamAbbrev } from "../src/lib/team-abbreviations";
import type { ProjectionsDataset } from "../src/lib/types";

const ROOT = process.cwd();

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
/** Which league this run syncs; Captains unless `--league` says otherwise. */
const CFG = fantraxLeagueArg(args, "league:sync");
const PATHS = fantraxPaths(CFG, ROOT);
const TEAM_ID = argValue("--team") ?? CFG.defaultTeamId;
const FULL_SCHEDULE = args.includes("--full-schedule");
const DYNASTY = !args.includes("--no-dynasty");
const SCHEDULE_MAX_AGE_DAYS = 7;
/** Available players pulled from fxpa for flags / Ros% (sorted by Fantrax rank). */
const AVAILABLE_SKATERS = 1500;
const AVAILABLE_GOALIES = 300;
/**
 * Minors-eligible available players (prospects) for the explorer pool:
 * about 2,150 in September 2026. Their flags only feed pool.json, never
 * state.json, so the planner's draft and waiver pools stay as they were.
 */
const AVAILABLE_PROSPECTS = 3000;
/** Only these icons change a decision; news icons (8/9/14) are dropped. */
const KEPT_ICONS = new Set<string>(Object.values(FANTRAX_ICON));
/** Prospect pool: unrostered minors-eligible players the crowd owns or drafts. */
const POOL_MIN_ROS = 1;
const POOL_MAX_ADP = 290;

/** Public Fantrax calls only, at least 1.1 s apart (the client's MIN_INTERVAL_MS). */
const req = { userAgent: SYNC_USER_AGENT };
const LEAGUE = CFG.leagueId;

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const fxTeam = (t: string | undefined) =>
  !t || t === FANTRAX_NO_TEAM ? FANTRAX_NO_TEAM : normalizeTeamAbbrev(t);

// ------------------------------------------------------------ fxpa parsing

interface PlayerFlagsRow {
  icons: string[];
  minorsEligible: boolean;
  age?: number;
  ros?: number;
  statusId?: string;
  ytd?: [number, number];
}

function parsePlayerStats(data: FxpaPlayerStatsData | null, ytd: boolean): Map<string, PlayerFlagsRow> {
  const out = new Map<string, PlayerFlagsRow>();
  if (!data?.statsTable) return out;
  const cells = data.tableHeader?.cells ?? [];
  const col = (pred: (c: { shortName?: string; key?: string; name?: string }) => boolean) =>
    cells.findIndex(pred);
  const iAge = col((c) => c.key === "age");
  const iRos = col((c) => c.shortName === "Ros" && (c.name ?? "").startsWith("% of Fantrax"));
  const iFpts = col((c) => c.key === "fpts");
  const iGp = col((c) => (c.key ?? "").endsWith("#2100#-1"));
  const isYtd =
    ytd && data.displayedSelections?.displayedSeasonOrProjection?.timeframeTypeCode === "YEAR_TO_DATE";
  for (const row of data.statsTable) {
    const s = row.scorer;
    const num = (i: number) => {
      if (i < 0) return undefined;
      const v = Number.parseFloat((row.cells[i]?.content ?? "").replace(/[%,]/g, ""));
      return Number.isFinite(v) ? v : undefined;
    };
    const fp = num(iFpts);
    const gp = num(iGp);
    out.set(s.scorerId, {
      icons: (s.icons ?? []).map((i) => i.typeId).filter((t) => KEPT_ICONS.has(t)),
      minorsEligible: !!s.minorsEligible,
      age: num(iAge),
      ros: num(iRos),
      statusId: s.statusId,
      ytd: isYtd && fp !== undefined && gp !== undefined && gp > 0 ? [fp, gp] : undefined,
    });
  }
  return out;
}

function parseCaps(data: FxpaTeamRosterInfoData | null): CapUsage | null {
  const rows = data?.scMinMaxData?.tableData;
  if (!rows) return null;
  const find = (label: string) => rows.find((r) => r.scoringCategory.includes(label));
  const gs = find("(GS)");
  const gp = find("(GP)");
  if (!gs || !gp) return null;
  return {
    gp: Number(gp.total) || 0,
    gpMax: Number(gp.max) || 0,
    gs: Number(gs.total) || 0,
    gsMax: Number(gs.max) || 0,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu Sep 24, 2026, 11:51PM" (Eastern) → "2026-09-24". */
function txDate(content: string | undefined): string | null {
  const m = /([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(content ?? "");
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]!) + 1;
  if (month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, "0")}-${m[2]!.padStart(2, "0")}`;
}

function countClaims(data: FxpaTransactionHistoryData | null, since: string): Record<string, number> | null {
  const rows = data?.table?.rows;
  if (!rows) return null;
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.transactionCode !== "CLAIM" || r.deleted || r.executed === false) continue;
    const team = r.cells.find((c) => c.key === "team")?.teamId;
    const date = txDate(r.cells.find((c) => c.key === "date")?.content);
    if (!team || !date || date < since) continue;
    out[team] = (out[team] ?? 0) + 1;
  }
  return out;
}

// ------------------------------------------------------------ NHL schedule

type Game = [string, string, string];

async function fetchWeek(date: string): Promise<NhlScheduleWeek> {
  return fetchJson<NhlScheduleWeek>(`https://api-web.nhle.com/v1/schedule/${date}`);
}

function weekGames(week: NhlScheduleWeek): Game[] {
  const out: Game[] = [];
  for (const day of week.gameWeek ?? []) {
    for (const g of day.games ?? []) {
      if (g.gameType !== 2) continue; // regular season only
      out.push([g.startTimeUTC, normalizeTeamAbbrev(g.awayTeam.abbrev), normalizeTeamAbbrev(g.homeTeam.abbrev)]);
    }
  }
  return out;
}

// ------------------------------------------------------------ NHL draft picks

interface NhlDraftPicksResponse {
  picks?: Array<{
    overallPick: number;
    teamAbbrev: string;
    firstName?: { default?: string };
    lastName?: { default?: string };
  }>;
}

/** A finished entry draft has about 224 picks; fewer means not held yet. */
const MIN_DRAFT_PICKS = 150;

/**
 * Every pick of the last `RECENT_NHL_DRAFTS` entry drafts, by year:
 * draft-registry.json keeps one pick per name (the earliest), so a recent
 * draftee who shares an older player's name has no line there. Years that
 * fail to load fall back to the registry's picks. The sync year counts once
 * its draft is held (June).
 */
async function recentDraftPicks(registry: PoolDraftPick[], syncYear: number): Promise<PoolDraftPick[]> {
  const load = async (year: number): Promise<PoolDraftPick[] | null> => {
    try {
      const d = await fetchJson<NhlDraftPicksResponse>(`https://api-web.nhle.com/v1/draft/picks/${year}/all`, 3);
      const picks = (d.picks ?? [])
        .filter((p) => p.firstName?.default && p.lastName?.default && Number.isFinite(p.overallPick))
        .map((p) => ({
          year,
          overallPick: p.overallPick,
          team: p.teamAbbrev,
          firstName: p.firstName!.default!,
          lastName: p.lastName!.default!,
        }));
      return picks.length >= MIN_DRAFT_PICKS ? picks : null;
    } catch (e) {
      console.warn(`WARN: NHL draft ${year} picks unavailable (registry used): ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  };
  const current = await load(syncYear);
  const last = current ? syncYear : syncYear - 1;
  const first = last - RECENT_NHL_DRAFTS + 1;
  const fetched = new Map<number, PoolDraftPick[]>();
  if (current) fetched.set(syncYear, current);
  for (let y = first; y <= last; y++) {
    if (fetched.has(y)) continue;
    const picks = await load(y);
    if (picks) fetched.set(y, picks);
  }
  const out = registry.filter((p) => !fetched.has(p.year) && p.year <= last);
  for (const picks of fetched.values()) out.push(...picks);
  console.log(`NHL drafts ${first}-${last}: ${[...fetched.values()].reduce((n, p) => n + p.length, 0)} picks fetched (${[...fetched.keys()].sort().join(", ") || "none"})`);
  return out;
}

async function syncSchedule(seasonStart: string, now: number): Promise<ScheduleSnapshot> {
  const prev = readJson<ScheduleSnapshot>(PATHS.schedule);
  const nowIso = new Date(now).toISOString();
  const ageDays = prev ? (now - Date.parse(prev.fetchedAt)) / 86_400_000 : Infinity;
  if (!FULL_SCHEDULE && prev && prev.games.length > 0 && ageDays < SCHEDULE_MAX_AGE_DAYS) {
    // Incremental: re-read the current and next week (postponements, flips).
    const today = torontoDate(now);
    const from = today < seasonStart ? seasonStart : today;
    const fresh: Game[] = [];
    for (const d of [from, addDays(from, 7)]) {
      fresh.push(...weekGames(await fetchWeek(d)));
      await new Promise((r) => setTimeout(r, 500));
    }
    const lo = from;
    const hi = addDays(from, 13);
    const kept = prev.games.filter((g) => {
      const d = torontoDate(Date.parse(g[0]));
      return d < lo || d > hi;
    });
    const games = [...kept, ...fresh].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return { season: CFG.nhlSeasonId, fetchedAt: prev.fetchedAt, updatedAt: nowIso, games };
  }
  const games: Game[] = [];
  let date: string | undefined = seasonStart;
  let end = "9999-12-31";
  for (let guard = 0; date && date <= end && guard < 40; guard++) {
    const week = await fetchWeek(date);
    if (week.regularSeasonEndDate) end = week.regularSeasonEndDate;
    games.push(...weekGames(week));
    date = week.nextStartDate;
    await new Promise((r) => setTimeout(r, 500));
  }
  const seen = new Set<string>();
  const unique = games.filter((g) => {
    const k = g.join("|");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  unique.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return { season: CFG.nhlSeasonId, fetchedAt: nowIso, updatedAt: nowIso, games: unique };
}

// ------------------------------------------------------------ main

async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  console.log(`league:sync ${CFG.slug} (${LEAGUE}) team ${TEAM_ID} @ ${nowIso}`);

  // ---- fxea (fatal on failure: keep the committed snapshot)
  const info = await fxeaGet<FxeaLeagueInfo>("getLeagueInfo", { leagueId: LEAGUE }, req);
  const rosterPeriods = toIsoPeriods(info.rosterPeriods);
  const scoringPeriods = toIsoPeriods(info.scoringPeriods);
  // A league where each player locks on his own game keeps today's lineup as
  // the target until its last game locks (the committed schedule is enough
  // to know when that is); elsewhere the period that starts next.
  const knownSchedule = readJson<ScheduleSnapshot>(PATHS.schedule);
  const target =
    (knownSchedule
      ? lineupTarget(rosterPeriods, indexSchedule(knownSchedule, rosterPeriods), now, CFG)
      : targetRosterPeriod(rosterPeriods, now)) ?? rosterPeriods[rosterPeriods.length - 1]!;
  const sp = scoringPeriodAt(scoringPeriods, Date.parse(target.start)) ?? scoringPeriods[scoringPeriods.length - 1]!;
  const rosters = await fxeaGet<FxeaTeamRosters>(
    "getTeamRosters",
    { leagueId: LEAGUE, period: target.number },
    req,
  );
  const standings = await fxeaGet<FxeaStandingsRow[]>("getStandings", { leagueId: LEAGUE }, req).catch(
    () => [] as FxeaStandingsRow[],
  );
  const draft = await fxeaGet<FxeaDraftResults>("getDraftResults", { leagueId: LEAGUE }, req).catch(() => null);
  const playerIds = await fxeaGet<FxeaPlayerIds>("getPlayerIds", { sport: "NHL" }, req);
  const adpRows = await fxeaPost<FxeaAdpRow[]>(
    "getAdp",
    { sport: "NHL", start: 1, limit: 1000, order: "ADP", showAllPositions: true },
    req,
  ).catch(() => [] as FxeaAdpRow[]);
  console.log(
    `fxea: ${Object.keys(info.playerInfo).length} pool players, rp ${target.number} (${target.start}), sp ${sp.number}, ${Object.keys(rosters.rosters).length} rosters, draft ${draft?.draftState ?? "n/a"}, ${adpRows.length} ADP rows`,
  );

  // ---- fxpa (non-fatal)
  const prevLeague = readJson<LeagueSnapshot>(PATHS.league);
  const teamIds = Object.keys(info.teamInfo);
  const haveAllCaps =
    prevLeague?.capsSource === "fxpa" &&
    prevLeague.scoringPeriods.length === scoringPeriods.length &&
    prevLeague.scoringPeriods.every((p) => p.gpMax != null && p.gsMax != null);
  const capPeriods =
    !CFG.features.gamesCaps || haveAllCaps
      ? []
      : scoringPeriods.map((p) => p.number).filter((n) => n !== sp.number);
  let fxpaOk = true;
  let fxpaError: string | undefined;
  const caps: Record<string, CapUsage> = {};
  const periodCaps = new Map<number, CapUsage>();
  let claims: Record<string, number> | null = null;
  const claimsSince = claimWeekStart(now, CFG.cadence.claimWeekStartsOn ?? 1);
  const flags = new Map<string, PlayerFlagsRow>();
  try {
    // A league whose config says fxpa is closed degrades like a failed read:
    // no icons, no Ros%, no caps, no claims — never league 1's values.
    if (!CFG.features.fxpa) throw new Error("fxpa is closed for this league (features.fxpa: false)");
    const rosterMsg = (teamId: string, period: number): FxpaMessage => ({
      method: "getTeamRosterInfo",
      data: { leagueId: LEAGUE, teamId, view: "GAMES_PER_POS", scoringPeriod: String(period) },
    });
    // Only the reads this league's features justify: a league without games
    // caps asks for none, a league without a weekly claim limit asks for no
    // transaction history.
    const capTeams = CFG.features.gamesCaps ? teamIds : [];
    const wantClaims = CFG.features.claimsPerWeek !== null;
    const batch1: FxpaMessage[] = [
      ...capTeams.map((t) => rosterMsg(t, sp.number)),
      ...capPeriods.map((p) => rosterMsg(TEAM_ID, p)),
      ...(wantClaims
        ? [
            {
              method: "getTransactionDetailsHistory",
              data: { leagueId: LEAGUE, maxResultsPerPage: "250", pageNumber: "1", view: "CLAIM_DROP" },
            } satisfies FxpaMessage,
          ]
        : []),
    ];
    const r1 = batch1.length > 0 ? await fxpaPost(batch1, req) : [];
    capTeams.forEach((t, i) => {
      const c = parseCaps(r1[i] as FxpaTeamRosterInfoData | null);
      if (c) caps[t] = c;
    });
    const mine = caps[TEAM_ID];
    if (mine) periodCaps.set(sp.number, mine);
    capPeriods.forEach((p, i) => {
      const c = parseCaps(r1[capTeams.length + i] as FxpaTeamRosterInfoData | null);
      if (c) periodCaps.set(p, c);
    });
    if (wantClaims) {
      claims = countClaims(r1[r1.length - 1] as FxpaTransactionHistoryData | null, claimsSince);
    }

    const stats = (filter: string, pos: string, n: number, ytd: boolean): FxpaMessage => ({
      method: "getPlayerStats",
      data: {
        leagueId: LEAGUE,
        statusOrTeamFilter: filter,
        positionOrGroup: pos,
        maxResultsPerPage: String(n),
        pageNumber: "1",
        ...(ytd
          ? { seasonOrProjection: `SEASON_${CFG.seasonCode}_YEAR_TO_DATE`, timeframeTypeCode: "YEAR_TO_DATE" }
          : {}),
      },
    });
    const r2 = await fxpaPost(
      [
        stats("ALL_TAKEN", "HOCKEY_SKATING", 1000, true),
        stats("ALL_TAKEN", "POS_201", 1000, true),
        stats("ALL_AVAILABLE", "HOCKEY_SKATING", AVAILABLE_SKATERS, false),
        stats("ALL_AVAILABLE", "POS_201", AVAILABLE_GOALIES, false),
      ],
      req,
    );
    r2.forEach((d, i) => {
      for (const [id, row] of parsePlayerStats(d as FxpaPlayerStatsData | null, i < 2)) flags.set(id, row);
    });
    if ((CFG.features.gamesCaps && Object.keys(caps).length === 0) || flags.size === 0) {
      throw new Error(`fxpa returned ${Object.keys(caps).length} caps / ${flags.size} player rows`);
    }
    console.log(`fxpa: caps for ${Object.keys(caps).length} teams, ${periodCaps.size} periods, ${flags.size} player rows`);
  } catch (e) {
    fxpaOk = false;
    fxpaError = e instanceof Error ? e.message : String(e);
    console.warn(`WARN: fxpa unavailable, degrading (no caps / icons / Ros%): ${fxpaError}`);
  }
  // Prospects' flags (age, Ros%, icons) for the explorer pool only. Optional:
  // without them the pool still lists every prospect, with fewer details.
  const prospectFlags = new Map<string, PlayerFlagsRow>();
  if (fxpaOk && CFG.features.minors) {
    try {
      const [d] = await fxpaPost(
        [
          {
            method: "getPlayerStats",
            data: {
              leagueId: LEAGUE,
              statusOrTeamFilter: "MINOR_FANTASY_AVAILABLE",
              positionOrGroup: "ALL",
              maxResultsPerPage: String(AVAILABLE_PROSPECTS),
              pageNumber: "1",
            },
          },
        ],
        req,
      );
      for (const [id, row] of parsePlayerStats(d as FxpaPlayerStatsData | null, false)) prospectFlags.set(id, row);
      console.log(`fxpa: ${prospectFlags.size} minors-eligible available players (explorer pool)`);
    } catch (e) {
      console.warn(`WARN: fxpa prospects unavailable (pool keeps fewer details): ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- league.json
  const scoring = scoringTableFromInfo(info.scoringSystem, CFG.scoringSource);
  const shape = scoringShape(scoring);
  const unscored = unscoredCategories(scoring);
  if (unscored.length > 0) {
    // The value model would drop them silently; check:league fails on this too.
    console.warn(`WARN: ${CFG.slug} scores categories the model has no rate for: ${unscored.join(", ")}`);
  }
  const prevCaps = new Map((prevLeague?.scoringPeriods ?? []).map((p) => [p.number, p]));
  const slotCounts = { ...CFG.slots.counts };
  for (const s of CFG.slots.order) {
    const c = info.rosterInfo.positionConstraints[s]?.maxActive;
    if (typeof c === "number") slotCounts[s as SlotId] = c;
  }
  const leagueSnap: LeagueSnapshot = {
    fetchedAt: nowIso,
    leagueId: LEAGUE,
    leagueName: info.leagueName,
    seasonYear: info.seasonYear,
    startDate: info.startDate,
    endDate: info.endDate,
    slotCounts,
    // fxea exposes only these two; minTotal / maxIr / maxMinors / the IR
    // grace period come from this league's own rules page (its config).
    limits: {
      ...CFG.limits,
      maxActive: info.rosterInfo.maxTotalActivePlayers ?? CFG.limits.maxActive,
      maxReserve: info.rosterInfo.maxTotalReservePlayers ?? CFG.limits.maxReserve,
    },
    scoring,
    sktMultiplier: CFG.features.captainSlot ? shape.sktMultiplier : 1,
    scoringPeriods: scoringPeriods.map((p) => {
      const c = periodCaps.get(p.number);
      const old = prevCaps.get(p.number);
      return { ...p, gpMax: c?.gpMax ?? old?.gpMax ?? null, gsMax: c?.gsMax ?? old?.gsMax ?? null };
    }),
    capsSource: periodCaps.size > 0 || prevLeague?.capsSource === "fxpa" ? "fxpa" : "none",
    rosterPeriods,
    teams: teamIds.map((id) => ({ id, name: info.teamInfo[id]!.name })),
    playoffs: info.playoffs
      ? { firstPeriod: info.playoffs.firstPlayoffPeriod, teams: info.playoffs.numPlayoffTeams }
      : null,
  };
  if (CFG.features.captainSlot && !shape.uniformSkt) {
    console.warn("WARN: Skt multiplier differs across categories; captain values approximate");
  }

  // ---- matching
  const dataset = JSON.parse(readFileSync(PATHS.players, "utf8")) as ProjectionsDataset;
  const profiles = (JSON.parse(readFileSync(PATHS.profiles, "utf8")) as { profiles: PlayerProfile[] }).profiles;
  const board = new Map(dataset.players.map((p) => [p.id, p]));
  const profileById = new Map(profiles.map((p) => [p.id, p]));
  const nhlPool: NhlMatchCandidate[] = profiles.map((p) => ({
    id: p.id,
    name: p.name,
    team: normalizeTeamAbbrev(board.get(p.id)?.team ?? p.team),
    groups: new Set([p.position, ...(p.positions ?? [])].map(groupOfPosition)),
  }));
  for (const p of dataset.players) {
    if (profileById.has(p.id)) continue;
    nhlPool.push({
      id: p.id,
      name: p.name,
      team: normalizeTeamAbbrev(p.team),
      groups: new Set(p.positions.map(groupOfPosition)),
    });
  }
  const fxPool: FantraxMatchPlayer[] = [];
  for (const [fid, pi] of Object.entries(info.playerInfo)) {
    const idRow = playerIds[fid];
    if (!idRow?.name) continue;
    fxPool.push({ fantraxId: fid, name: idRow.name, team: fxTeam(idRow.team), groups: groupsFromEligible(pi.eligiblePos, CFG) });
  }
  const overridesFile = readJson<{ overrides: Array<{ fantraxId: string; nhlId: number | null }> }>(PATHS.overrides);
  const overrides = Object.fromEntries((overridesFile?.overrides ?? []).map((o) => [o.fantraxId, o.nhlId]));
  const matches = matchFantraxToNhl(fxPool, nhlPool, overrides, normalizeTeamAbbrev);
  const methods: Record<string, number> = {};
  for (const m of matches.values()) methods[m.method] = (methods[m.method] ?? 0) + 1;
  const nhlIds: NhlIdsSnapshot = {
    fetchedAt: nowIso,
    methods,
    ids: Object.fromEntries([...matches.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, v.nhlId])),
  };

  // ---- values.json
  const stateRosters = rostersFromFxea(rosters);
  const rostered = new Set(Object.values(stateRosters).flatMap((r) => r.map((it) => it.id)));
  const players: Record<string, ValueRecord> = {};
  let priorCount = 0;
  for (const fx of fxPool) {
    const fid = fx.fantraxId;
    const eligiblePos = info.playerInfo[fid]!.eligiblePos;
    const match = matches.get(fid);
    const proj = match ? board.get(match.nhlId) : undefined;
    if (!proj && !rostered.has(fid)) continue;
    const profile = match ? profileById.get(match.nhlId) : undefined;
    const age = flags.get(fid)?.age ?? profile?.bio?.ageAtSeasonStart;
    const base = {
      n: fantraxDisplayName(fx.name),
      t: fx.team,
      e: eligiblePos,
      ...(age !== undefined ? { age } : {}),
    };
    const { record, prior } = valueRecord(scoring, base, proj, profile, CFG);
    players[fid] = record;
    if (prior) priorCount++;
  }
  // Goalie start shares within each NHL club, injured / minors goalies removed.
  attachGoalieStartShares(players, (id) => flags.get(id)?.icons);
  const values: ValuesSnapshot = {
    fetchedAt: nowIso,
    season: dataset.season,
    projectionsAt: dataset.generatedAt,
    players: Object.fromEntries(Object.entries(players).sort((a, b) => a[0].localeCompare(b[0]))),
  };

  // ---- state.json
  const keep = new Set([...Object.keys(players), ...rostered]);
  const icons: Record<string, string[]> = {};
  const ros: Record<string, number> = {};
  const ytd: Record<string, [number, number]> = {};
  const minorsEligible: string[] = [];
  for (const [id, f] of flags) {
    if (!keep.has(id)) continue;
    if (f.icons.length) icons[id] = f.icons;
    if (f.ros !== undefined) ros[id] = f.ros;
    if (f.ytd) ytd[id] = f.ytd;
    if (f.minorsEligible) minorsEligible.push(id);
  }
  const adp: Record<string, number> = {};
  for (const row of adpRows) if (row.id && Number.isFinite(row.ADP)) adp[row.id] = row.ADP;
  const state: StateSnapshot = {
    fetchedAt: nowIso,
    fxpaOk,
    ...(fxpaError ? { fxpaError } : {}),
    rosterPeriod: target.number,
    scoringPeriod: sp.number,
    rosters: stateRosters,
    waivers: Object.entries(info.playerInfo)
      .filter(([, p]) => p.status === "WW")
      .map(([id]) => id)
      .sort(),
    icons,
    minorsEligible: minorsEligible.sort(),
    ros,
    ytd,
    caps,
    claims,
    claimsWeekStart: claimsSince,
    draft: draft ? draftFromFxea(draft) : null,
    adp,
    standings: standings.map((s) => ({
      teamId: s.teamId,
      rank: s.rank,
      record: s.points,
      pointsFor: s.totalPointsFor,
    })),
  };

  // ---- pool.json (explorer: projected players + prospects)
  const registry = readJson<{ byName: Record<string, PoolDraftPick> }>(PATHS.draftRegistry);
  if (!registry) console.warn("WARN: draft-registry.json missing: the pool only has the recent NHL drafts");
  const draftPicks = await recentDraftPicks(Object.values(registry?.byName ?? {}), new Date(now).getUTCFullYear());
  const poolFlags = new Map<string, PoolFlags>(prospectFlags);
  for (const [id, f] of flags) poolFlags.set(id, f);
  // Same membership as state.ros (the draft and waiver helpers' "listed by Fantrax").
  const listed = fxpaOk ? new Set([...flags].filter(([, f]) => f.ros !== undefined).map(([id]) => id)) : null;
  const pool = buildPool({
    fetchedAt: nowIso,
    season: dataset.season,
    projectionsAt: dataset.generatedAt,
    leaguePlayers: info.playerInfo,
    identity: Object.fromEntries(fxPool.map((f) => [f.fantraxId, { name: f.name, team: f.team }])),
    rosters: stateRosters,
    values: players,
    flags: poolFlags,
    listed,
    adp,
    nhlIds: nhlIds.ids,
    bios: new Map(profiles.map((p) => [p.id, { birthDate: p.bio?.birthDate, draft: p.draft }] as const)),
    draftPicks,
    teamAlias: normalizeTeamAbbrev,
    config: CFG,
  });
  // ---- prospect-pool.json: unrostered minors-eligible players without a
  // values row (additive: values.json / state.json are untouched by it).
  // Same flags as pool.json (the minors-eligible read included), so every
  // prospect the player table lists with a Ros% or an ADP gets a dynasty
  // value: the general available list alone only reaches ~120 of them.
  const fxById = new Map(fxPool.map((f) => [f.fantraxId, f]));
  const poolPlayers: ProspectPoolSnapshot["players"] = {};
  const prospectCandidates = new Map<string, PlayerFlagsRow>(prospectFlags);
  for (const [id, f] of flags) prospectCandidates.set(id, f);
  for (const [id, f] of prospectCandidates) {
    if (!f.minorsEligible || rostered.has(id) || players[id]) continue;
    const fx = fxById.get(id);
    if (!fx) continue;
    const a = adp[id];
    if (!((f.ros ?? 0) >= POOL_MIN_ROS || (a !== undefined && a < POOL_MAX_ADP))) continue;
    poolPlayers[id] = {
      n: fantraxDisplayName(fx.name),
      t: fx.team,
      e: info.playerInfo[id]?.eligiblePos ?? "",
      ...(f.age !== undefined ? { age: f.age } : {}),
      ...(f.ros !== undefined ? { ros: f.ros } : {}),
      ...(a !== undefined ? { adp: a } : {}),
      ...(f.ytd && f.ytd[1] > 0 ? { gp: f.ytd[1] } : {}),
      icons: f.icons,
    };
  }
  const prospectPool: ProspectPoolSnapshot = {
    fetchedAt: nowIso,
    players: Object.fromEntries(Object.entries(poolPlayers).sort((x, y) => x[0].localeCompare(y[0]))),
  };

  // ---- schedule
  const schedule = await syncSchedule(info.startDate, now);
  console.log(`schedule: ${schedule.games.length} regular-season games (full rebuild ${schedule.fetchedAt})`);

  // ---- Slapshot profile: dynasty values and contracts before the plan
  // Every player carries over and a salary cap binds, so the plan's cap line
  // reads the contracts the dynasty build derives. The build does not read
  // this league's values/state files (its universe is the shared projection
  // set), only its own rosters and picks, written first from the payloads
  // above. Non-fatal: without a fresh build the committed contracts stay.
  let contracts: ContractsFile | null = null;
  if (CFG.dynastyProfile === "slapshot") {
    writeSlapshotPool(slapshotPoolFrom(info, rosters, draft, nowIso), slapshotPaths(ROOT).pool);
    if (DYNASTY) {
      try {
        const b = runSlapshotBuild({ out: PATHS.dynasty });
        const errs = slapshotChecks(b);
        for (const e of errs) console.warn(`WARN: dynasty (slapshot): ${e}`);
        console.log(
          `OK: dynasty values for ${Object.keys(b.snapshot.players).length} players (λ ${b.snapshot.params.lambda[0]} pts/M$, ${(b.ms / 1000).toFixed(1)} s)`,
        );
      } catch (e) {
        console.warn(`WARN: dynasty build failed, dynasty.json left as is: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    // The browser's copies (and contracts.json) of whatever dynasty.json is there now.
    writeClientDynasty(PATHS.dynasty);
    contracts = readJson<ContractsFile>(PATHS.contracts);
    if (!contracts) console.warn("WARN: no contracts.json: the plan carries no cap line");
  }

  // ---- today.json (default team plan, server-rendered by the league's tabs)
  // The value model the draft board ranks by, built once from this league's
  // own projected pool (null for a league `points-vor` does not cover).
  const vor = leagueVor(CFG, values.players, (id) => seasonFp(values.players[id]!, CFG), leagueSnap.slotCounts);
  const plan = buildDailyPlan({
    league: leagueSnap,
    state,
    values,
    schedule,
    teamId: TEAM_ID,
    nowMs: now,
    config: CFG,
    vor,
    contracts,
  });

  // All fetched: write everything (each file atomically).
  writeFileAtomic(PATHS.league, `${JSON.stringify(leagueSnap)}\n`);
  writeFileAtomic(PATHS.nhlIds, `${JSON.stringify(nhlIds)}\n`);
  writeFileAtomic(PATHS.values, `${JSON.stringify(values)}\n`);
  writeFileAtomic(PATHS.state, `${JSON.stringify(state)}\n`);
  writeFileAtomic(PATHS.pool, `${JSON.stringify(pool)}\n`);
  writeFileAtomic(PATHS.schedule, `${JSON.stringify(schedule)}\n`);
  writeFileAtomic(PATHS.today, `${JSON.stringify(plan)}\n`);
  // Without fxpa there are no minors flags: keep the previous pool. A league
  // without Minors slots has no prospect pool at all.
  if (fxpaOk && CFG.features.minors) writeFileAtomic(PATHS.prospectPool, `${JSON.stringify(prospectPool)}\n`);

  const activeIds = Object.values(stateRosters).flat().filter((r) => r.status === "ACTIVE").map((r) => r.id);
  const activeMatched = activeIds.filter((id) => players[id]?.src === "proj").length;
  console.log(
    `values: ${Object.keys(players).length} players (${priorCount} priors); ACTIVE matched ${activeMatched}/${activeIds.length}; ids ${JSON.stringify(methods)}`,
  );
  console.log(
    `pool: ${pool.counts.total} players (${pool.counts.projected} projected, ${pool.counts.prospects} prospects, ${pool.counts.other} other; NHL drafts ${pool.recentDrafts.join("-")})`,
    `prospect pool: ${Object.keys(prospectPool.players).length} unrostered minors-eligible players${fxpaOk ? "" : " (not written: fxpa down)"}`,
  );
  console.log(`OK: league:sync wrote snapshot (fxpaOk=${fxpaOk})`);

  // The stand-alone live draft page embeds the same values and contracts:
  // regenerate it with them (build:pages does it again before every deploy).
  if (CFG.dynastyProfile === "slapshot") {
    try {
      const r = buildSlapshotDraftPage();
      console.log(`OK: public/slapshot-draft.html (${r.rows} players, ${Math.round(r.bytes / 1024)} KB)`);
    } catch (e) {
      console.warn(`WARN: slapshot-draft.html not regenerated: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ---- dynasty values (depend on rosters, Ros%, ADP and the pool just written)
  // Only for the Captains profile here: its cutdown (10 keepers + 30
  // minors-eligible) is that league's rule and must never be computed, let
  // alone shown, for another one. The Slapshot profile ran above, before the
  // plan. Non-fatal: the season snapshot above is already written;
  // check:league flags a dynasty.json that no longer matches the rosters.
  if (DYNASTY && !CFG.features.dynasty) {
    console.log(`dynasty: skipped (${CFG.slug} has no keeper-forever model)`);
  }
  if (DYNASTY && CFG.dynastyProfile === "captains") {
    try {
      const { result, ms } = runDynastyBuild({}, loadDynastyFiles(dynastyPaths(ROOT, CFG)));
      console.log(
        `OK: dynasty values for ${Object.keys(result.snapshot.players).length} players (K ${result.snapshot.params.K.value}, ${(ms / 1000).toFixed(1)} s)`,
      );
    } catch (e) {
      console.warn(`WARN: dynasty build failed, dynasty.json left as is: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

main().catch((e) => {
  console.error(`FAIL: league:sync — ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
