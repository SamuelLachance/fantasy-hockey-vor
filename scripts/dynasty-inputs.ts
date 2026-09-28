/**
 * File side of the dynasty build, shared by `npm run dynasty:build`
 * (scripts/build-dynasty.ts) and the end of `npm run league:sync`: read the
 * synced snapshot and the frozen research tables, join them per Fantrax id,
 * run the pure model (src/lib/dynasty) and write public/fantrax/dynasty.json.
 *
 * Reads: public/fantrax/{values,state,schedule-20262027}.json,
 *   src/data/fantrax/{nhl-ids,prospect-pool}.json, src/data/players.json
 *   (projectionMethod), src/data/player-profiles.json (birth date, career GP,
 *   draft, last seasons), src/data/draft-registry.json,
 *   src/data/dynasty/{params,prospects}.json.
 *
 * Career GP for the eligibility gate = profile career totals without any
 * 2026-27 rows (profiles are collected in the offseason) + Fantrax
 * season-to-date GP (state.ytd; the pool's `gp`), so a mid-season rebuild
 * counts the games already played. Goalie start shares are recomputed as
 * depth-chart shares (injured partners kept in; see segment.ts).
 */
import { existsSync, readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { writeClientDynasty } from "./dynasty-client";
import { normalizeDraftName, type DraftRegistry } from "../src/lib/draft-registry";
import { depthChartShares } from "../src/lib/dynasty/segment";
import {
  buildDynasty,
  DEFAULT_PATHS,
  parseParams,
  type BuildOptions,
  type BuildResult,
  type DynastyBuildInputs,
  type DynastyInput,
  type DynastyParams,
  type DynastySnapshot,
  type ProspectsFile,
  type SeasonLine,
} from "../src/lib/dynasty/index";
import { CAPTAINS_DYNASTY, NHL_SEASON_ID, parseGroups, type FantraxLeagueConfig } from "../src/lib/fantrax/config";
import { orgBios, type NhlOrgBiosFile, type OrgBio } from "../src/lib/fantrax/org-players";
import { ageOn, type PoolRecord, type PoolSnapshot } from "../src/lib/fantrax/pool";
import type { LeagueSeasonsCache } from "../src/lib/league-seasons";
import type { NhlRostersFile } from "../src/lib/nhl-rosters";
import { fantraxPaths } from "./fantrax-paths";
import type {
  ProspectPoolSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";
import type { PlayerProfile } from "../src/lib/profile-types";
import type { ProjectionsDataset } from "../src/lib/types";

/**
 * Files of the Captains-profile dynasty build, for one Fantrax league. Only a
 * league whose config runs that profile ever gets here (see
 * `dynastyProfile`); the default is the Captains league, with its historical
 * flat paths. The Slapshot profile has its own inputs
 * (scripts/dynasty-slapshot.ts `slapshotPaths`).
 */
export function dynastyPaths(root = process.cwd(), cfg: FantraxLeagueConfig = CAPTAINS_DYNASTY) {
  if (cfg.dynastyProfile !== "captains") {
    throw new Error(`league ${cfg.slug} does not run the Captains dynasty profile (dynastyProfile: ${cfg.dynastyProfile})`);
  }
  const p = fantraxPaths(cfg, root);
  return {
    values: p.values,
    state: p.state,
    schedule: p.schedule,
    out: p.dynasty,
    nhlIds: p.nhlIds,
    pool: p.prospectPool,
    /** The league's explorer pool (public/.../pool.json): its NHL-organisation players join the build. */
    explorer: p.pool,
    nhlRosters: p.nhlRosters,
    nhlOrgBios: p.nhlOrgBios,
    leagueSeasons: p.leagueSeasons,
    players: p.players,
    profiles: p.profiles,
    registry: p.draftRegistry,
    params: p.dynastyParams,
    prospects: p.dynastyProspects,
    benchmarks: p.dynastyBenchmarks,
  };
}
export type DynastyPaths = ReturnType<typeof dynastyPaths>;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
export const readOptional = <T>(path: string): T | null => (existsSync(path) ? readJson<T>(path) : null);

export interface LoadedDynastyFiles {
  paths: DynastyPaths;
  values: ValuesSnapshot;
  state: StateSnapshot;
  schedule: ScheduleSnapshot | null;
  nhlIds: Record<string, number>;
  pool: ProspectPoolSnapshot | null;
  /** The league's explorer pool (its NHL-organisation players join the build). */
  explorer: PoolSnapshot | null;
  /** The NHL organisations' players and what the repo knows of them. */
  org: OrgData;
  params: DynastyParams;
  prospects: ProspectsFile;
}

/** The NHL organisations' players (nhl-rosters.json) and their bios by NHL id. */
export interface OrgData {
  ids: Set<number>;
  /** Birth date and draft (nhl-org-bios.json, league-seasons.json, the lists). */
  bios: Map<number, OrgBio>;
  /** NHL games before the current season (league-seasons.json), for players without a profile. */
  careerGp: Map<number, number>;
}

export function loadOrgData(paths: { nhlRosters: string; nhlOrgBios: string; leagueSeasons: string }): OrgData {
  const players = readOptional<NhlRostersFile>(paths.nhlRosters)?.players ?? [];
  const seasons = readOptional<LeagueSeasonsCache>(paths.leagueSeasons)?.players ?? {};
  const bios = orgBios(players, { bios: readOptional<NhlOrgBiosFile>(paths.nhlOrgBios)?.players, seasons });
  const careerGp = new Map<number, number>();
  for (const p of players) {
    const ls = seasons[String(p.id)];
    if (!ls) continue;
    careerGp.set(p.id, ls.seasons.filter((l) => l[1] === "NHL" && l[0] < NHL_SEASON_ID).reduce((s, l) => s + l[2], 0));
  }
  return { ids: new Set(players.map((p) => p.id)), bios, careerGp };
}

export function loadDynastyFiles(paths = dynastyPaths()): LoadedDynastyFiles {
  return {
    paths,
    values: readJson<ValuesSnapshot>(paths.values),
    state: readJson<StateSnapshot>(paths.state),
    schedule: readOptional<ScheduleSnapshot>(paths.schedule),
    nhlIds: readJson<{ ids: Record<string, number> }>(paths.nhlIds).ids,
    pool: readOptional<ProspectPoolSnapshot>(paths.pool),
    explorer: readOptional<PoolSnapshot>(paths.explorer),
    org: loadOrgData(paths),
    params: parseParams(readJson<unknown>(paths.params)),
    prospects: readJson<ProspectsFile>(paths.prospects),
  };
}

/**
 * Dynasty inputs of explorer-pool players nothing else covers (no values
 * row, research record or prospect-pool row): Captains' NHL-organisation
 * players, every other Slapshot pool player. Birth date and draft by NHL id
 * (profile, then the organisation bios: an id-keyed draft), else the pool's
 * (its draft a name match: trusted with an age only, segment.ts); a Fantrax
 * age more than a year off the NHL birth date drops both (the id match is
 * suspect). Position group from the pool's groups (C/W/LW/RW → F).
 */
export function poolExtraInputs(
  records: readonly PoolRecord[],
  ctx: {
    cfg: FantraxLeagueConfig;
    profiles: ReadonlyMap<number, PlayerProfile>;
    org: OrgData;
    /** Minors-eligible now; `x`: what the input knows of him (positions, NHL games). */
    eligNow: (r: PoolRecord, x: { e: string; careerGp: number | null; seasonGp: number }) => boolean | null;
    rostered: (id: string) => boolean;
    leaguePick?: (id: string) => number | undefined;
    seasonGp?: (id: string) => number;
    /** Fantrax eligiblePos when known (else the pool's groups). */
    eligiblePos?: (id: string) => string | undefined;
    /** Birth date as of this instant for the age check. */
    nowMs: number;
  },
): DynastyInput[] {
  const out: DynastyInput[] = [];
  for (const r of records) {
    const prof = r.nhl != null ? ctx.profiles.get(r.nhl) : undefined;
    const bio = r.nhl != null ? ctx.org.bios.get(r.nhl) : undefined;
    let birthDate: string | null = prof?.bio?.birthDate ?? bio?.birthDate ?? r.bd ?? null;
    let draft: { year: number; pick: number } | undefined;
    let draftSource: "profile" | "registry" | undefined;
    if (prof) {
      if (prof.draft?.overallPick) [draft, draftSource] = [{ year: prof.draft.year, pick: prof.draft.overallPick }, "profile"];
    } else if (bio?.draft !== undefined) {
      if (bio.draft) [draft, draftSource] = [{ year: bio.draft.year, pick: bio.draft.overallPick }, "profile"];
    } else if (r.dr) [draft, draftSource] = [{ year: r.dr[0], pick: r.dr[1] }, "registry"];
    // a Fantrax age more than a year off the NHL birth date: the id match is suspect
    const fromBirth = birthDate ? ageOn(birthDate, ctx.nowMs) : undefined;
    if (r.age !== undefined && fromBirth !== undefined && Math.abs(r.age - fromBirth) > 1) {
      birthDate = null;
      if (draftSource === "profile") [draft, draftSource] = [undefined, undefined];
    }
    const e = ctx.eligiblePos?.(r.id) || parseGroups(r.pos, ctx.cfg).map((g) => (g === "LW" || g === "RW" ? "W" : g)).join(",");
    const careerGp = prof ? careerGpBeforeSeason(prof) : r.nhl != null ? (ctx.org.careerGp.get(r.nhl) ?? null) : null;
    const leaguePick = ctx.leaguePick?.(r.id);
    const seasonGp = ctx.seasonGp?.(r.id) ?? 0;
    out.push({
      id: r.id,
      n: r.n,
      e,
      team: r.t || null,
      ...(r.nhl != null ? { nhlId: r.nhl } : {}),
      birthDate,
      ...(r.age !== undefined ? { fantraxAge: r.age } : {}),
      careerGp,
      seasonGp,
      ...(draft ? { draft, draftSource } : {}),
      eligNow: ctx.eligNow(r, { e, careerGp, seasonGp }),
      ...(r.nhl != null && ctx.org.ids.has(r.nhl) ? { org: true } : {}),
      history: historyOf(prof),
      ...(r.ros !== undefined ? { ros: r.ros } : {}),
      ...(r.adp !== undefined ? { adp: r.adp } : {}),
      ...(leaguePick !== undefined ? { leaguePick } : {}),
      rostered: ctx.rostered(r.id),
    });
  }
  return out;
}

function historyOf(p: PlayerProfile | undefined): SeasonLine[] | undefined {
  if (!p?.teamHistory?.length || p.isGoalie) return undefined;
  return p.teamHistory.map((h) => ({
    season: Math.floor(h.seasonId / 10000),
    gp: h.gamesPlayed ?? 0,
    toi: Number.isFinite(h.stats?.toiPerGame) ? h.stats.toiPerGame! : null,
    goals: h.stats?.goals ?? 0,
    assists: h.stats?.assists ?? 0,
    shots: h.stats?.shots ?? 0,
    hits: h.advanced?.hits ?? 0,
    blocks: h.advanced?.blocks ?? 0,
    takeaways: h.advanced?.takeaways ?? 0,
  }));
}

/**
 * Career NHL GP before the current season: the profile's career totals less
 * any rows of the season in progress (a profile collected mid-season already
 * counts some of them; state.ytd adds them all back).
 */
export function careerGpBeforeSeason(p: PlayerProfile | undefined): number | null {
  const total = p?.careerTotals?.gamesPlayed;
  if (total == null || !Number.isFinite(total)) return null;
  const current = (p?.teamHistory ?? [])
    .filter((h) => h.seasonId === NHL_SEASON_ID)
    .reduce((s, h) => s + (h.gamesPlayed ?? 0), 0);
  return Math.max(0, total - current);
}

/** Share of each team's regular season still to play at `nowMs` (1 before opening night). */
export function remainingShares(schedule: ScheduleSnapshot | null, nowMs: number): Record<string, number> {
  const total = new Map<string, number>();
  const left = new Map<string, number>();
  for (const [start, away, home] of schedule?.games ?? []) {
    const future = Date.parse(start) > nowMs;
    for (const t of [away, home]) {
      total.set(t, (total.get(t) ?? 0) + 1);
      if (future) left.set(t, (left.get(t) ?? 0) + 1);
    }
  }
  const out: Record<string, number> = {};
  for (const [t, n] of total) out[t] = Math.round(((left.get(t) ?? 0) / n) * 1000) / 1000;
  return out;
}

/**
 * One input per player: every values.json row, plus the modeled prospects
 * and the prospect pool (unrostered minors-eligible) without a values row.
 */
export function assembleDynastyInputs(L: LoadedDynastyFiles): DynastyBuildInputs {
  const { values, state, nhlIds, pool, prospects, paths } = L;
  const dataset = readJson<ProjectionsDataset>(paths.players);
  const method = new Map(dataset.players.map((p) => [p.id, p.projectionMethod ?? null]));
  // Games from the split-season rule: its spread blends the dynasty route (segment.ts).
  const gpSd = new Map(
    dataset.players.flatMap((p) => (p.availability?.gpSd != null ? [[p.id, p.availability.gpSd] as const] : [])),
  );
  const profiles = new Map(readJson<{ profiles: PlayerProfile[] }>(paths.profiles).profiles.map((p) => [p.id, p]));
  const registry = readJson<DraftRegistry>(paths.registry).byName;
  const rostered = new Set(Object.values(state.rosters).flat().map((r) => r.id));
  const minorsEligible = new Set(state.minorsEligible);
  const leaguePick = new Map((state.draft?.picks ?? []).filter((p) => p.playerId).map((p) => [p.playerId!, p.pick]));
  const poolDraft = new Map((L.explorer?.players ?? []).flatMap((r) => (r.dr ? [[r.id, r.dr] as const] : [])));
  /**
   * Draft by trust: the profile, the organisation bio (the NHL landing, by
   * NHL id: a player it says is undrafted takes no namesake's pick), the
   * registry by name, then the explorer pool's pick (the club's recent picks
   * matched by name and age). The last two are name matches, trusted with an
   * age only (segment.ts).
   */
  const draftOf = (prof: PlayerProfile | undefined, name: string, id: string, nhlId: number | undefined) => {
    if (prof?.draft?.overallPick) {
      return { draft: { year: prof.draft.year, pick: prof.draft.overallPick }, source: "profile" as const };
    }
    const bio = !prof && nhlId ? L.org.bios.get(nhlId) : undefined;
    if (bio?.draft) return { draft: { year: bio.draft.year, pick: bio.draft.overallPick }, source: "profile" as const };
    if (bio?.draft === null) return undefined;
    const r = registry[normalizeDraftName(name)];
    if (r) return { draft: { year: r.year, pick: r.overallPick }, source: "registry" as const };
    const dr = poolDraft.get(id);
    return dr ? { draft: { year: dr[0], pick: dr[1] }, source: "registry" as const } : undefined;
  };
  const orgBirth = (nhlId: number | undefined) => (nhlId ? L.org.bios.get(nhlId)?.birthDate : undefined);
  // fxpa covered him (rostered, or in the available lists): the minors flag is known.
  const flagKnown = (id: string) => rostered.has(id) || id in state.ros || id in state.icons;
  const ytdGp = (id: string) => Math.max(0, state.ytd?.[id]?.[1] ?? 0);
  // Goalie depth-chart shares: an injured starter keeps his job (his absence
  // trims season 0 through status0), his partner is not promoted for good.
  const depth = depthChartShares(
    L.params,
    Object.entries(values.players)
      .filter(([, v]) => v.gE !== undefined)
      .map(([id, v]) => ({ id, team: v.t, gp: v.gp, icons: state.icons[id] })),
  );
  const players: DynastyInput[] = [];

  for (const [id, v] of Object.entries(values.players)) {
    const nhlId = nhlIds[id];
    const prof = nhlId ? profiles.get(nhlId) : undefined;
    const rec = prospects.players[id];
    const m = nhlId ? method.get(nhlId) : undefined;
    const draft = draftOf(prof, v.n, id, nhlId);
    const pS = v.gE !== undefined ? (depth.get(id) ?? v.pS) : undefined;
    players.push({
      id,
      n: v.n,
      e: v.e,
      team: v.t && !v.t.startsWith("(") ? v.t : null,
      ...(nhlId ? { nhlId } : {}),
      birthDate: prof?.bio?.birthDate ?? rec?.birthDate ?? prospects.birthDates?.[id] ?? orgBirth(nhlId) ?? null,
      ...(v.age !== undefined ? { fantraxAge: v.age } : {}),
      careerGp: careerGpBeforeSeason(prof),
      seasonGp: ytdGp(id),
      ...(state.icons[id]?.length ? { status: state.icons[id] } : {}),
      proj: {
        src: v.src,
        gp: v.gp,
        ...(v.off !== undefined ? { off: v.off } : {}),
        ...(v.dx !== undefined ? { dx: v.dx } : {}),
        ...(v.gE !== undefined ? { gE: v.gE } : {}),
        ...(pS !== undefined ? { pS } : {}),
        method: m === "ml" || m === "contextual" ? m : null,
        ...(v.src === "proj" && nhlId && gpSd.has(nhlId) ? { gpSd: gpSd.get(nhlId)! } : {}),
      },
      ...(rec ? { prospect: rec } : {}),
      ...(draft ? { draft: draft.draft, draftSource: draft.source } : {}),
      eligNow: minorsEligible.has(id) ? true : state.fxpaOk && flagKnown(id) ? false : null,
      ...(nhlId && L.org.ids.has(nhlId) ? { org: true } : {}),
      history: historyOf(prof),
      ...(state.ros[id] !== undefined ? { ros: state.ros[id] } : {}),
      ...(state.adp[id] !== undefined ? { adp: state.adp[id] } : {}),
      ...(leaguePick.has(id) ? { leaguePick: leaguePick.get(id)! } : {}),
      rostered: rostered.has(id),
    });
  }
  const extra = new Set([...Object.keys(prospects.players), ...Object.keys(pool?.players ?? {})]);
  for (const id of [...extra].sort()) {
    if (values.players[id]) continue;
    const rec = prospects.players[id];
    const pp = pool?.players[id];
    const name = pp?.n ?? rec?.n;
    if (!name) continue;
    const nhlId = nhlIds[id] ?? rec?.nhlId;
    const prof = nhlId ? profiles.get(nhlId) : undefined;
    const draft = draftOf(prof, name, id, nhlId);
    const ros = pp?.ros ?? state.ros[id];
    const adp = state.adp[id] ?? pp?.adp;
    players.push({
      id,
      n: name,
      e: pp?.e ?? "",
      team: pp?.t && !pp.t.startsWith("(") ? pp.t : null,
      ...(nhlId ? { nhlId } : {}),
      birthDate: prof?.bio?.birthDate ?? rec?.birthDate ?? prospects.birthDates?.[id] ?? orgBirth(nhlId) ?? null,
      ...(pp?.age !== undefined ? { fantraxAge: pp.age } : {}),
      careerGp: careerGpBeforeSeason(prof),
      seasonGp: Math.max(ytdGp(id), pp?.gp ?? 0),
      ...((pp?.icons ?? state.icons[id])?.length ? { status: pp?.icons ?? state.icons[id] } : {}),
      ...(rec ? { prospect: rec, posHint: rec.pos } : {}),
      ...(draft ? { draft: draft.draft, draftSource: draft.source } : {}),
      eligNow: pp || minorsEligible.has(id) ? true : null,
      ...(nhlId && L.org.ids.has(nhlId) ? { org: true } : {}),
      history: historyOf(prof),
      ...(ros !== undefined ? { ros } : {}),
      ...(adp !== undefined ? { adp } : {}),
      ...(leaguePick.has(id) ? { leaguePick: leaguePick.get(id)! } : {}),
      rostered: rostered.has(id),
    });
  }
  // The league's NHL-organisation players and pool prospects (recent picks
  // whose rights lapsed included) nothing above covers (investigation
  // 2026-09-27: 239 of the draftable universe never valued), under this
  // league's own minors rule: Fantrax's minors-eligible flag, « not eligible »
  // when fxpa listed him without it, else the rule by age and games.
  const covered = new Set(players.map((x) => x.id));
  const orgRows = (L.explorer?.players ?? []).filter(
    (r) => !covered.has(r.id) && ((r.nhl != null && L.org.ids.has(r.nhl)) || r.src === "e"),
  );
  players.push(
    ...poolExtraInputs(orgRows, {
      cfg: CAPTAINS_DYNASTY,
      profiles,
      org: L.org,
      eligNow: (r) => (r.me ? true : r.ros !== undefined ? false : null),
      rostered: (id) => rostered.has(id),
      leaguePick: (id) => leaguePick.get(id),
      seasonGp: ytdGp,
      nowMs: Date.parse(state.fetchedAt),
    }),
  );
  return {
    players,
    meta: {
      valuesFetchedAt: values.fetchedAt,
      stateFetchedAt: state.fetchedAt,
      projectionsAt: values.projectionsAt,
      prospectsBuiltAt: prospects.builtAt,
      poolFetchedAt: pool?.fetchedAt ?? null,
    },
    remainingShare: remainingShares(L.schedule, Date.parse(state.fetchedAt)),
    league: {
      rosters: Object.fromEntries(Object.entries(state.rosters).map(([team, rows]) => [team, rows.map((r) => r.id)])),
      remainingPicks: (state.draft?.picks ?? [])
        .filter((p) => !p.playerId)
        .sort((a, b) => a.pick - b.pick)
        .map((p) => p.teamId),
    },
  };
}

/** A rebuild at most this often when only Ros% / ADP / rosters moved. */
export const DYNASTY_MAX_AGE_HOURS = 20;

/** Why the existing dynasty.json can be kept, or null when it must be rebuilt. */
export function dynastyUpToDate(L: LoadedDynastyFiles, out = L.paths.out): string | null {
  const prev = readOptional<DynastySnapshot>(out);
  if (!prev?.inputs) return null;
  const i = prev.inputs;
  if (i.paramsVersion !== L.params.version) return null;
  if (i.projectionsAt !== L.values.projectionsAt) return null;
  if (i.prospectsBuiltAt !== L.prospects.builtAt) return null;
  if ((i.poolFetchedAt ?? null) !== (L.pool?.fetchedAt ?? null)) return null;
  const rostered = Object.values(L.state.rosters).flat().map((r) => r.id);
  if (rostered.some((id) => L.values.players[id] && !prev.players[id])) return null;
  const ageH = (Date.parse(L.state.fetchedAt) - Date.parse(i.stateFetchedAt)) / 3_600_000;
  if (!(ageH >= 0 && ageH < DYNASTY_MAX_AGE_HOURS)) return null;
  return `dynasty.json is current (state ${ageH.toFixed(1)} h newer, same projections/params/prospects)`;
}

export interface RunDynastyOptions extends BuildOptions {
  out?: string;
  paths?: number;
}

/** Load, build and write public/fantrax/dynasty.json. */
export function runDynastyBuild(
  opts: RunDynastyOptions = {},
  L: LoadedDynastyFiles = loadDynastyFiles(),
): { result: BuildResult; inputs: DynastyBuildInputs; ms: number; out: string } {
  const t0 = Date.now();
  const inputs = assembleDynastyInputs(L);
  const result = buildDynasty(inputs, L.params, { ...opts, paths: opts.paths ?? DEFAULT_PATHS });
  const out = opts.out ?? L.paths.out;
  writeFileAtomic(out, `${JSON.stringify(result.snapshot)}\n`);
  // The browser's copy (dynasty-table.json), next to it.
  writeClientDynasty(out);
  return { result, inputs, ms: Date.now() - t0, out };
}
