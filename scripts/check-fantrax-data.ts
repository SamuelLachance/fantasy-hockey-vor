/**
 * CI guard for the committed Fantrax (/league) snapshot. Runs inside
 * `npm run check`, so a truncated or malformed sync can never ship.
 * Staleness only warns: the page refreshes rosters live and says how old
 * the baked data is. The dynasty values (public/fantrax/dynasty.json) are
 * optional for the page, but when present they must pass the hard gates of
 * src/lib/dynasty/checks.ts (schema, coverage, K, composition, Spearman
 * sanity against ADP / Ros% / the 2027 keep score, the aging guard).
 * Run: npx tsx scripts/check-fantrax-data.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_SLOT_COUNTS,
  FANTRAX_DEFAULT_TEAM_ID,
  NHL_SEASON_ID,
  SLOT_ORDER,
} from "../src/lib/fantrax/config";
import { POOL_GROUPS, type PoolSnapshot } from "../src/lib/fantrax/pool";
import { dynastyGates } from "../src/lib/dynasty/checks";
import { scoringShape } from "../src/lib/fantrax/scoring";
import type {
  DynastySnapshot,
  LeagueSnapshot,
  NhlIdsSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";

const ROOT = process.cwd();
const EXPECTED_TEAMS = 16;
const EXPECTED_SCORING_PERIODS = 24;
const MIN_ACTIVE_MATCH = 0.95;
const STALE_WARN_HOURS = 36;
/** Explorer pool: floor on size and prospects, ceiling on the file (it is fetched on /league). */
const MIN_POOL_PLAYERS = 1500;
const MIN_POOL_PROSPECTS = 300;
const MAX_POOL_BYTES = 750_000;

const errors: string[] = [];
const warnings: string[] = [];

function load<T>(...parts: string[]): T | null {
  const path = join(ROOT, ...parts);
  const label = parts.join("/");
  if (!existsSync(path)) {
    errors.push(`${label} is missing — run npm run league:sync`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    errors.push(`${label} is not valid JSON: ${e}`);
    return null;
  }
}

const league = load<LeagueSnapshot>("src", "data", "fantrax", "league.json");
const nhlIds = load<NhlIdsSnapshot>("src", "data", "fantrax", "nhl-ids.json");
const today = load<{ teamId: string; generatedAt: string }>("src", "data", "fantrax", "today.json");
const overrides = load<{ overrides: Array<{ fantraxId: string; nhlId: number | null }> }>(
  "src",
  "data",
  "fantrax",
  "id-overrides.json",
);
const values = load<ValuesSnapshot>("public", "fantrax", "values.json");
const state = load<StateSnapshot>("public", "fantrax", "state.json");
const schedule = load<ScheduleSnapshot>("public", "fantrax", `schedule-${NHL_SEASON_ID}.json`);
const pool = load<PoolSnapshot>("public", "fantrax", "pool.json");

if (league) {
  if (league.teams.length !== EXPECTED_TEAMS) {
    errors.push(`league has ${league.teams.length} teams (expected ${EXPECTED_TEAMS})`);
  }
  for (const s of SLOT_ORDER) {
    if (league.slotCounts[s] !== DEFAULT_SLOT_COUNTS[s]) {
      errors.push(`slot ${s} count is ${league.slotCounts[s]} (expected ${DEFAULT_SLOT_COUNTS[s]})`);
    }
  }
  if (league.scoringPeriods.length !== EXPECTED_SCORING_PERIODS) {
    errors.push(`${league.scoringPeriods.length} scoring periods (expected ${EXPECTED_SCORING_PERIODS})`);
  }
  const noCaps = league.scoringPeriods.filter((p) => !(p.gpMax! > 0) || !(p.gsMax! > 0));
  if (noCaps.length > 0) {
    errors.push(`${noCaps.length} scoring periods without GP/GS caps (e.g. #${noCaps[0]!.number})`);
  }
  const badDates = [...league.scoringPeriods, ...league.rosterPeriods].filter(
    (p) => !Number.isFinite(Date.parse(p.start)) || !Number.isFinite(Date.parse(p.end)) || p.start >= p.end,
  );
  if (badDates.length > 0) errors.push(`${badDates.length} periods with invalid ISO dates`);
  if (league.rosterPeriods.length < 150) {
    errors.push(`only ${league.rosterPeriods.length} lineup periods (expected ~188 daily periods)`);
  }
  const shape = scoringShape(league.scoring);
  if (!shape.uniformSkt) warnings.push("Skt multiplier differs across categories — captain math is approximate");
  const unknownSlots = shape.overrideSlots.filter((s) => s !== "D" && s !== "Skt");
  if (unknownSlots.length > 0) {
    errors.push(`scoring has slot overrides the model ignores: ${unknownSlots.join(", ")}`);
  }
  if (!(league.sktMultiplier > 1)) errors.push(`sktMultiplier is ${league.sktMultiplier} (captain slot missing?)`);
}

if (schedule) {
  const perTeam = new Map<string, number>();
  for (const [start, away, home] of schedule.games) {
    if (!Number.isFinite(Date.parse(start))) errors.push(`schedule game with bad start ${start}`);
    for (const t of [away, home]) perTeam.set(t, (perTeam.get(t) ?? 0) + 1);
  }
  const counts = [...new Set(perTeam.values())];
  // 2026-27 is the first 84-game season; older fixtures used 82.
  if (perTeam.size !== 32) errors.push(`schedule covers ${perTeam.size} teams (expected 32)`);
  if (counts.length !== 1 || (counts[0] !== 82 && counts[0] !== 84)) {
    errors.push(`uneven schedule: games per team ${JSON.stringify(Object.fromEntries(perTeam))}`);
  } else if (schedule.games.length !== (32 * counts[0]!) / 2) {
    errors.push(`${schedule.games.length} schedule games (expected ${(32 * counts[0]!) / 2})`);
  }
}

if (values) {
  const bad = Object.entries(values.players).filter(([, r]) =>
    [r.gp, r.off, r.dx, r.gE, r.pS].some((x) => x !== undefined && !Number.isFinite(x)),
  );
  if (bad.length > 0) errors.push(`${bad.length} value records with non-finite numbers (e.g. ${bad[0]![0]})`);
  const shapeless = Object.entries(values.players).filter(
    ([, r]) => (r.gE === undefined) === (r.off === undefined),
  );
  if (shapeless.length > 0) errors.push(`${shapeless.length} value records are neither skater nor goalie`);
  if (Object.keys(values.players).length < 1000) {
    errors.push(`only ${Object.keys(values.players).length} value records (expected >= 1000)`);
  }
}

if (state && values) {
  if (Object.keys(state.rosters).length !== EXPECTED_TEAMS) {
    errors.push(`state has ${Object.keys(state.rosters).length} rosters (expected ${EXPECTED_TEAMS})`);
  }
  const all = Object.values(state.rosters).flat();
  const missing = all.filter((r) => !values.players[r.id]);
  if (missing.length > 0) errors.push(`${missing.length} rostered players have no value record`);
  const active = all.filter((r) => r.status === "ACTIVE");
  const matched = active.filter((r) => values.players[r.id]?.src === "proj").length;
  if (active.length > 0 && matched / active.length < MIN_ACTIVE_MATCH) {
    errors.push(
      `ACTIVE projection match ${matched}/${active.length} (${((100 * matched) / active.length).toFixed(1)}%) below ${MIN_ACTIVE_MATCH * 100}%`,
    );
  }
  if (!state.fxpaOk) warnings.push(`snapshot built without fxpa (${state.fxpaError ?? "unknown error"})`);
  const ageH = (Date.now() - Date.parse(state.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(ageH)) errors.push(`state.fetchedAt is invalid: ${state.fetchedAt}`);
  else if (ageH > STALE_WARN_HOURS) warnings.push(`Fantrax snapshot is ${ageH.toFixed(0)} h old — run npm run league:sync`);
}

if (pool) {
  const size = readFileSync(join(ROOT, "public", "fantrax", "pool.json")).length;
  if (size > MAX_POOL_BYTES) errors.push(`pool.json is ${size} B (budget ${MAX_POOL_BYTES} B)`);
  const players = Array.isArray(pool.players) ? pool.players : [];
  if (pool.v !== 1) errors.push(`pool.json version ${String(pool.v)} (expected 1)`);
  if (players.length < MIN_POOL_PLAYERS) errors.push(`pool has ${players.length} players (expected >= ${MIN_POOL_PLAYERS})`);
  const bySrc = { p: 0, e: 0, n: 0 } as Record<string, number>;
  for (const p of players) bySrc[p.src] = (bySrc[p.src] ?? 0) + 1;
  if ((bySrc.e ?? 0) < MIN_POOL_PROSPECTS) errors.push(`pool has ${bySrc.e ?? 0} prospects (expected >= ${MIN_POOL_PROSPECTS})`);
  const c = pool.counts;
  if (!c || c.total !== players.length || c.projected !== bySrc.p || c.prospects !== bySrc.e || c.other !== bySrc.n) {
    errors.push(`pool counts ${JSON.stringify(c)} disagree with its players`);
  }
  const ids = players.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("pool lists a Fantrax id twice");
  if (ids.some((id, i) => i > 0 && ids[i - 1]! >= id)) errors.push("pool is not sorted by Fantrax id");
  const teamIds = new Set(Object.keys(state?.rosters ?? {}));
  const groups = new Set<string>(POOL_GROUPS);
  const finite = (x: unknown) => x === undefined || (typeof x === "number" && Number.isFinite(x));
  const bad = players.filter(
    (p) =>
      !p.n ||
      !p.pos ||
      [...p.pos].some((g) => !groups.has(g)) ||
      !(p.st === "FA" || p.st === "WW" || teamIds.size === 0 || teamIds.has(p.st)) ||
      !["p", "e", "n"].includes(p.src) ||
      (p.src === "p") !== (p.fp !== undefined) ||
      ![p.age, p.ros, p.adp, p.fp, p.fpg, p.gp, p.nhl].every(finite) ||
      (p.age !== undefined && (p.age < 14 || p.age > 50)) ||
      (p.ros !== undefined && (p.ros < 0 || p.ros > 100)) ||
      (p.dr !== undefined && !(Array.isArray(p.dr) && p.dr.length === 3 && p.dr[0] >= 1979 && p.dr[1] >= 1)) ||
      (p.bd !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(p.bd)),
  );
  if (bad.length > 0) errors.push(`${bad.length} malformed pool records (e.g. ${JSON.stringify(bad[0])})`);
  const inPool = new Map(players.map((p) => [p.id, p]));
  if (values) {
    const lost = Object.entries(values.players).filter(([id, r]) => r.src === "proj" && inPool.get(id)?.src !== "p");
    if (lost.length > 0) errors.push(`${lost.length} projected players missing from the pool (e.g. ${lost[0]![0]})`);
  }
  if (state) {
    const rostered = Object.entries(state.rosters).flatMap(([t, r]) => r.map((x) => [x.id, t] as const));
    const missing = rostered.filter(([id]) => !inPool.has(id));
    if (missing.length > 0) errors.push(`${missing.length} rostered players missing from the pool (e.g. ${missing[0]![0]})`);
    const wrongTeam = rostered.filter(([id, t]) => inPool.has(id) && inPool.get(id)!.st !== t);
    if (wrongTeam.length > 0) errors.push(`${wrongTeam.length} pool players on the wrong fantasy team (e.g. ${wrongTeam[0]![0]})`);
    const adpIds = Object.keys(state.adp);
    const adpIn = adpIds.filter((id) => inPool.has(id)).length;
    if (adpIds.length > 0 && adpIn / adpIds.length < 0.9) {
      errors.push(`only ${adpIn}/${adpIds.length} players with a Fantrax ADP are in the pool`);
    }
    const waiversOut = state.waivers.filter((id) => inPool.get(id)?.st !== "WW" && !Object.values(state.rosters).some((r) => r.some((x) => x.id === id)));
    if (waiversOut.length > 0) errors.push(`${waiversOut.length} players on waivers missing from the pool as WW (e.g. ${waiversOut[0]})`);
    // The explorer's « actifs » rule reads `nl`; it must say what state.ros says.
    const nlWrong = state.fxpaOk
      ? players.filter((p) => values?.players[p.id] && (p.nl === 1) === p.id in state.ros)
      : players.filter((p) => p.nl);
    if (nlWrong.length > 0) errors.push(`${nlWrong.length} pool players whose « listed by Fantrax » flag disagrees with state.ros (e.g. ${nlWrong[0]!.id})`);
  }
  // One NHL draft pick, one player: a pick on two records is a bad name match.
  const byPick = new Map<string, string>();
  const shared: string[] = [];
  for (const p of players) {
    if (!p.dr) continue;
    const k = `${p.dr[0]} #${p.dr[1]}`;
    const prev = byPick.get(k);
    if (prev) shared.push(`${k} (${prev}, ${p.id})`);
    else byPick.set(k, p.id);
  }
  if (shared.length > 0) errors.push(`NHL draft picks on two pool records: ${shared.slice(0, 5).join("; ")}`);
  const [from, to] = pool.recentDrafts ?? [0, 0];
  const recent = players.filter((p) => p.dr && p.dr[0] >= from && p.dr[0] <= to).length;
  if (to - from !== 5 || recent < 150 * 6) {
    errors.push(`pool covers NHL drafts ${from}-${to} with ${recent} picks (expected 6 drafts, >= 900 picks)`);
  }
}

if (nhlIds) {
  const seen = new Map<number, string>();
  const dupes: string[] = [];
  for (const [fid, id] of Object.entries(nhlIds.ids)) {
    const prev = seen.get(id);
    if (prev) dupes.push(`${id} (${prev}, ${fid})`);
    else seen.set(id, fid);
  }
  if (dupes.length > 0) errors.push(`NHL ids claimed twice: ${dupes.slice(0, 5).join("; ")}`);
}

if (overrides) {
  const ids = overrides.overrides.map((o) => o.fantraxId);
  if (new Set(ids).size !== ids.length) errors.push("id-overrides.json lists a Fantrax id twice");
  if (nhlIds) {
    for (const o of overrides.overrides) {
      if (o.nhlId !== null && nhlIds.ids[o.fantraxId] !== undefined && nhlIds.ids[o.fantraxId] !== o.nhlId) {
        errors.push(`override ${o.fantraxId} → ${o.nhlId} not applied (nhl-ids has ${nhlIds.ids[o.fantraxId]})`);
      }
    }
  }
}

// ---- dynasty values (optional file; gated when present)
const dynastyPath = join(ROOT, "public", "fantrax", "dynasty.json");
let dynastyNote = "no dynasty.json";
if (!existsSync(dynastyPath)) {
  warnings.push("public/fantrax/dynasty.json is missing — run npm run dynasty:build (the page falls back to season values)");
} else if (values && state) {
  let dynasty: DynastySnapshot | null = null;
  try {
    dynasty = JSON.parse(readFileSync(dynastyPath, "utf8")) as DynastySnapshot;
  } catch (e) {
    errors.push(`public/fantrax/dynasty.json is not valid JSON: ${e}`);
  }
  if (dynasty) {
    const benchPath = join(ROOT, "src", "data", "dynasty", "benchmarks.json");
    const bench = existsSync(benchPath)
      ? (JSON.parse(readFileSync(benchPath, "utf8")) as { keepScore27: Record<string, number> })
      : null;
    const gates = dynastyGates({
      snapshot: dynasty,
      values: values.players,
      rostered: new Set(Object.values(state.rosters).flat().map((r) => r.id)),
      adp: state.adp,
      ros: state.ros,
      minorsEligible: new Set(state.minorsEligible),
      keepScore27: bench?.keepScore27,
    });
    for (const e of gates.errors) errors.push(`dynasty: ${e}`);
    for (const w of gates.warnings) warnings.push(`dynasty: ${w}`);
    if (dynasty.inputs?.projectionsAt !== values.projectionsAt) {
      warnings.push(`dynasty.json was built on projections ${dynasty.inputs?.projectionsAt} (values.json has ${values.projectionsAt}) — run npm run dynasty:build`);
    }
    const lagH = (Date.parse(state.fetchedAt) - Date.parse(dynasty.inputs?.stateFetchedAt ?? "")) / 3_600_000;
    if (!(lagH < 48)) warnings.push(`dynasty.json is ${Number.isFinite(lagH) ? lagH.toFixed(0) : "?"} h older than state.json — run npm run dynasty:build`);
    else if (dynasty.inputs?.stateFetchedAt !== state.fetchedAt) {
      // league:sync rebuilds it last: an older one means that step failed (or --no-dynasty).
      warnings.push(`dynasty.json comes from an earlier sync (${dynasty.inputs?.stateFetchedAt}, state.json ${state.fetchedAt}): the 2027 cutdown odds follow the older rosters — run npm run dynasty:build`);
    }
    // The player table's prospects (pool.json) should carry the dynasty values of the same sync.
    if (pool && dynasty.inputs?.poolFetchedAt && dynasty.inputs.poolFetchedAt !== pool.fetchedAt) {
      warnings.push(`dynasty.json was built on prospect-pool ${dynasty.inputs.poolFetchedAt}, pool.json is from ${pool.fetchedAt}`);
    }
    dynastyNote = `dynasty ${Object.keys(dynasty.players).length} players (K ${dynasty.params?.K?.value})`;
  }
}

// /league is public: the baked files may name teams but never their owners.
for (const [label, data] of Object.entries({ league, today, state, values, pool })) {
  if (data && /"owner/i.test(JSON.stringify(data))) errors.push(`${label} carries an owner field (owner names must not be published)`);
}

if (today && today.teamId !== FANTRAX_DEFAULT_TEAM_ID) {
  errors.push(`today.json is for ${today.teamId} (expected default team ${FANTRAX_DEFAULT_TEAM_ID})`);
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: Fantrax snapshot — ${Object.keys(values?.players ?? {}).length} value records, ${pool?.counts.total ?? 0} pool players (${pool?.counts.prospects ?? 0} prospects), ${schedule?.games.length ?? 0} games, synced ${state?.fetchedAt}; ${dynastyNote}`,
);
