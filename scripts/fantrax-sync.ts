/**
 * Pulls the Captains Dynasty League (Fantrax) state and bakes the /league
 * snapshot: src/data/fantrax/{league,nhl-ids,today,prospect-pool}.json and
 * public/fantrax/{values,state,schedule-20262027}.json, then rebuilds the
 * dynasty values public/fantrax/dynasty.json (scripts/dynasty-inputs.ts,
 * ~15 s; skip with --no-dynasty).
 *
 * Read-only and unauthenticated: fxea (public Beta API) for settings,
 * rosters, draft, ids and ADP; two batched fxpa POSTs for caps, injury /
 * minors flags, Ros% and claims; NHL api-web for the schedule. Fantrax
 * requests are >= 1 s apart with a descriptive User-Agent. If fxpa fails the
 * sync still writes everything with `state.fxpaOk = false`; if fxea fails it
 * exits non-zero and leaves the committed snapshot untouched.
 *
 * Run: npm run league:sync [-- --full-schedule] [-- --team <teamId>] [-- --no-dynasty]
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
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
  DEFAULT_ROSTER_LIMITS,
  DEFAULT_SLOT_COUNTS,
  FANTRAX_DEFAULT_TEAM_ID,
  FANTRAX_ICON,
  FANTRAX_LEAGUE_ID,
  FANTRAX_NO_TEAM,
  FANTRAX_SEASON_CODE,
  NHL_SEASON_ID,
  SLOT_ORDER,
  SYNC_USER_AGENT,
  type SlotId,
} from "../src/lib/fantrax/config";
import { buildDailyPlan } from "../src/lib/fantrax/daily-plan";
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
import {
  goalieStartShares,
  goalieValueFromProjection,
  isRuledOut,
  priorGoalieValue,
  priorSkaterValue,
  PRIOR_GOALIE_GP,
  skaterValueFromProjection,
  takeawaysPerGame,
} from "../src/lib/fantrax/points-model";
import { parseScoringTable, scoringShape } from "../src/lib/fantrax/scoring";
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
import { runDynastyBuild } from "./dynasty-inputs";
import type { PlayerProfile } from "../src/lib/profile-types";
import { normalizeTeamAbbrev } from "../src/lib/team-abbreviations";
import type { GoalieProjection, ProjectionsDataset, SkaterProjection } from "../src/lib/types";

const ROOT = process.cwd();
const PATHS = {
  league: join(ROOT, "src", "data", "fantrax", "league.json"),
  nhlIds: join(ROOT, "src", "data", "fantrax", "nhl-ids.json"),
  today: join(ROOT, "src", "data", "fantrax", "today.json"),
  overrides: join(ROOT, "src", "data", "fantrax", "id-overrides.json"),
  prospectPool: join(ROOT, "src", "data", "fantrax", "prospect-pool.json"),
  values: join(ROOT, "public", "fantrax", "values.json"),
  state: join(ROOT, "public", "fantrax", "state.json"),
  schedule: join(ROOT, "public", "fantrax", `schedule-${NHL_SEASON_ID}.json`),
  players: join(ROOT, "src", "data", "players.json"),
  profiles: join(ROOT, "src", "data", "player-profiles.json"),
};

const args = process.argv.slice(2);
const argValue = (flag: string) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const TEAM_ID = argValue("--team") ?? FANTRAX_DEFAULT_TEAM_ID;
const FULL_SCHEDULE = args.includes("--full-schedule");
const DYNASTY = !args.includes("--no-dynasty");
const SCHEDULE_MAX_AGE_DAYS = 7;
/** Available players pulled from fxpa for flags / Ros% (sorted by Fantrax rank). */
const AVAILABLE_SKATERS = 1500;
const AVAILABLE_GOALIES = 300;
/** Only these icons change a decision; news icons (8/9/14) are dropped. */
const KEPT_ICONS = new Set<string>(Object.values(FANTRAX_ICON));
/** Prospect pool: unrostered minors-eligible players the crowd owns or drafts. */
const POOL_MIN_ROS = 1;
const POOL_MAX_ADP = 290;

const req = { userAgent: SYNC_USER_AGENT };
const LEAGUE = FANTRAX_LEAGUE_ID;

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

const round = (x: number, d = 3) => Math.round(x * 10 ** d) / 10 ** d;
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
    return { season: NHL_SEASON_ID, fetchedAt: prev.fetchedAt, updatedAt: nowIso, games };
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
  return { season: NHL_SEASON_ID, fetchedAt: nowIso, updatedAt: nowIso, games: unique };
}

// ------------------------------------------------------------ main

async function main() {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  console.log(`league:sync ${LEAGUE} team ${TEAM_ID} @ ${nowIso}`);

  // ---- fxea (fatal on failure: keep the committed snapshot)
  const info = await fxeaGet<FxeaLeagueInfo>("getLeagueInfo", { leagueId: LEAGUE }, req);
  const rosterPeriods = toIsoPeriods(info.rosterPeriods);
  const scoringPeriods = toIsoPeriods(info.scoringPeriods);
  const target = targetRosterPeriod(rosterPeriods, now) ?? rosterPeriods[rosterPeriods.length - 1]!;
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
  const capPeriods = haveAllCaps ? [] : scoringPeriods.map((p) => p.number).filter((n) => n !== sp.number);
  let fxpaOk = true;
  let fxpaError: string | undefined;
  const caps: Record<string, CapUsage> = {};
  const periodCaps = new Map<number, CapUsage>();
  let claims: Record<string, number> | null = null;
  const claimsSince = claimWeekStart(now);
  const flags = new Map<string, PlayerFlagsRow>();
  try {
    const rosterMsg = (teamId: string, period: number): FxpaMessage => ({
      method: "getTeamRosterInfo",
      data: { leagueId: LEAGUE, teamId, view: "GAMES_PER_POS", scoringPeriod: String(period) },
    });
    const batch1: FxpaMessage[] = [
      ...teamIds.map((t) => rosterMsg(t, sp.number)),
      ...capPeriods.map((p) => rosterMsg(TEAM_ID, p)),
      {
        method: "getTransactionDetailsHistory",
        data: { leagueId: LEAGUE, maxResultsPerPage: "250", pageNumber: "1", view: "CLAIM_DROP" },
      },
    ];
    const r1 = await fxpaPost(batch1, req);
    teamIds.forEach((t, i) => {
      const c = parseCaps(r1[i] as FxpaTeamRosterInfoData | null);
      if (c) caps[t] = c;
    });
    const mine = caps[TEAM_ID];
    if (mine) periodCaps.set(sp.number, mine);
    capPeriods.forEach((p, i) => {
      const c = parseCaps(r1[teamIds.length + i] as FxpaTeamRosterInfoData | null);
      if (c) periodCaps.set(p, c);
    });
    claims = countClaims(r1[r1.length - 1] as FxpaTransactionHistoryData | null, claimsSince);

    const stats = (filter: string, pos: string, n: number, ytd: boolean): FxpaMessage => ({
      method: "getPlayerStats",
      data: {
        leagueId: LEAGUE,
        statusOrTeamFilter: filter,
        positionOrGroup: pos,
        maxResultsPerPage: String(n),
        pageNumber: "1",
        ...(ytd
          ? { seasonOrProjection: `SEASON_${FANTRAX_SEASON_CODE}_YEAR_TO_DATE`, timeframeTypeCode: "YEAR_TO_DATE" }
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
    if (Object.keys(caps).length === 0 || flags.size === 0) {
      throw new Error(`fxpa returned ${Object.keys(caps).length} caps / ${flags.size} player rows`);
    }
    console.log(`fxpa: caps for ${Object.keys(caps).length} teams, ${periodCaps.size} periods, ${flags.size} player rows`);
  } catch (e) {
    fxpaOk = false;
    fxpaError = e instanceof Error ? e.message : String(e);
    console.warn(`WARN: fxpa unavailable, degrading (no caps / icons / Ros%): ${fxpaError}`);
  }

  // ---- league.json
  const scoring = parseScoringTable(info.scoringSystem.scoringCategorySettings);
  const shape = scoringShape(scoring);
  const prevCaps = new Map((prevLeague?.scoringPeriods ?? []).map((p) => [p.number, p]));
  const slotCounts = { ...DEFAULT_SLOT_COUNTS };
  for (const s of SLOT_ORDER) {
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
    limits: {
      ...DEFAULT_ROSTER_LIMITS,
      maxActive: info.rosterInfo.maxTotalActivePlayers ?? DEFAULT_ROSTER_LIMITS.maxActive,
      maxReserve: info.rosterInfo.maxTotalReservePlayers ?? DEFAULT_ROSTER_LIMITS.maxReserve,
    },
    scoring,
    sktMultiplier: shape.sktMultiplier,
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
  if (!shape.uniformSkt) console.warn("WARN: Skt multiplier differs across categories; captain values approximate");

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
    fxPool.push({ fantraxId: fid, name: idRow.name, team: fxTeam(idRow.team), groups: groupsFromEligible(pi.eligiblePos) });
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
    const tokens = eligiblePos.split(",");
    const isGoalie = tokens.includes("G") && !tokens.some((t) => t === "C" || t === "W" || t === "D");
    const age = flags.get(fid)?.age ?? profile?.bio?.ageAtSeasonStart;
    const base = {
      n: fantraxDisplayName(fx.name),
      t: fx.team,
      e: eligiblePos,
      ...(age !== undefined ? { age } : {}),
    };
    if (isGoalie) {
      if (proj?.isGoalie) {
        const p = proj.projection as GoalieProjection;
        const gE = goalieValueFromProjection(
          scoring,
          { gamesPlayed: proj.gamesPlayed, wins: p.wins, shutouts: p.shutouts, saves: p.saves, savePct: p.savePct },
          profile ? { gamesPlayed: profile.careerTotals?.gamesPlayed ?? 0, otLosses: profile.careerTotals?.otLosses, assists: profile.careerTotals?.assists } : null,
        );
        players[fid] = { ...base, gp: proj.gamesPlayed, gE: round(gE), src: "proj" };
      } else {
        priorCount++;
        players[fid] = { ...base, gp: fx.team === FANTRAX_NO_TEAM ? 0 : PRIOR_GOALIE_GP, gE: priorGoalieValue(), src: "prior" };
      }
      continue;
    }
    const dEligible = tokens.includes("D");
    const primaryD = proj ? (proj.primaryPosition ?? proj.position) === "D" : dEligible && !tokens.includes("C") && !tokens.includes("W");
    if (proj && !proj.isGoalie) {
      const p = proj.projection as SkaterProjection;
      const tk = dEligible
        ? takeawaysPerGame(
            (profile?.teamHistory ?? []).map((h) => ({
              seasonId: h.seasonId,
              gamesPlayed: h.gamesPlayed,
              takeaways: h.advanced?.takeaways,
            })),
          )
        : undefined;
      const v = skaterValueFromProjection(
        scoring,
        { gamesPlayed: proj.gamesPlayed, goals: p.goals, assists: p.assists, shots: p.shots, hits: p.hits, blocks: p.blocks },
        { primaryD, dEligible, takeawaysPerGame: tk },
      );
      players[fid] = { ...base, gp: proj.gamesPlayed, off: round(v.off), dx: round(v.dx), src: "proj" };
    } else {
      priorCount++;
      const v = priorSkaterValue(primaryD);
      players[fid] = { ...base, gp: 0, off: v.off, dx: dEligible ? v.dx : 0, src: "prior" };
    }
  }
  // Goalie start shares within each NHL club, injured / minors goalies removed.
  const shares = goalieStartShares(
    Object.entries(players)
      .filter(([, r]) => r.gE !== undefined)
      .map(([id, r]) => ({ id, team: r.t, gp: r.gp, healthy: !isRuledOut({ team: r.t, icons: flags.get(id)?.icons }) })),
  );
  for (const [id, p] of shares) players[id]!.pS = round(p);
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

  // ---- prospect-pool.json: unrostered minors-eligible players without a
  // values row (additive: values.json / state.json are untouched by it)
  const fxById = new Map(fxPool.map((f) => [f.fantraxId, f]));
  const poolPlayers: ProspectPoolSnapshot["players"] = {};
  for (const [id, f] of flags) {
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

  // ---- today.json (default team plan, server-rendered by /league)
  const plan = buildDailyPlan({ league: leagueSnap, state, values, schedule, teamId: TEAM_ID, nowMs: now });

  // All fetched: write everything (each file atomically).
  writeFileAtomic(PATHS.league, `${JSON.stringify(leagueSnap)}\n`);
  writeFileAtomic(PATHS.nhlIds, `${JSON.stringify(nhlIds)}\n`);
  writeFileAtomic(PATHS.values, `${JSON.stringify(values)}\n`);
  writeFileAtomic(PATHS.state, `${JSON.stringify(state)}\n`);
  writeFileAtomic(PATHS.schedule, `${JSON.stringify(schedule)}\n`);
  writeFileAtomic(PATHS.today, `${JSON.stringify(plan)}\n`);
  // Without fxpa there are no minors flags: keep the previous pool.
  if (fxpaOk) writeFileAtomic(PATHS.prospectPool, `${JSON.stringify(prospectPool)}\n`);

  const activeIds = Object.values(stateRosters).flat().filter((r) => r.status === "ACTIVE").map((r) => r.id);
  const activeMatched = activeIds.filter((id) => players[id]?.src === "proj").length;
  console.log(
    `values: ${Object.keys(players).length} players (${priorCount} priors); ACTIVE matched ${activeMatched}/${activeIds.length}; ids ${JSON.stringify(methods)}`,
  );
  console.log(
    `prospect pool: ${Object.keys(prospectPool.players).length} unrostered minors-eligible players${fxpaOk ? "" : " (not written: fxpa down)"}`,
  );
  console.log(`OK: league:sync wrote snapshot (fxpaOk=${fxpaOk})`);

  // ---- dynasty values (depend on rosters, Ros%, ADP and the pool just written)
  // Non-fatal: the season snapshot above is already written; check:league
  // flags a dynasty.json that no longer matches the rosters.
  if (DYNASTY) {
    try {
      const { result, ms } = runDynastyBuild();
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
