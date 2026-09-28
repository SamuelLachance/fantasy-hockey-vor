/**
 * CI guard for one Fantrax league's committed snapshot. Runs inside
 * `npm run check`, so a truncated or malformed sync can never ship.
 * Staleness only warns: the page refreshes rosters live and says how old
 * the baked data is. The dynasty values (<public>/dynasty.json) are
 * optional for the page, but when present they must pass the hard gates of
 * src/lib/dynasty/checks.ts (schema, coverage, K, composition, Spearman
 * sanity against ADP / Ros% / the 2027 keep score, the aging guard) — and
 * they may only exist at all for a league whose config enables the keeper
 * model.
 *
 * Every expectation comes from the league's config: team count, slot table,
 * matchup cadence, roster limits and which of caps / minors / captain /
 * dynasty it has. Nothing here is a Captains number in disguise.
 *
 * Run: npx tsx scripts/check-fantrax-data.ts [--league <slug>]
 */
import { existsSync, readFileSync } from "fs";
import { FANTRAX_GROUPS, eligibleGroups, parseGroups } from "../src/lib/fantrax/config";
import { poolGroups, type PoolSnapshot } from "../src/lib/fantrax/pool";
import { dynastyGates } from "../src/lib/dynasty/checks";
import { deadCategories, scoringShape, unmodeledSlots, unscoredCategories } from "../src/lib/fantrax/scoring";
import { fantraxLeagueArg, fantraxPaths } from "./fantrax-paths";
import type {
  DynastySnapshot,
  LeagueSnapshot,
  NhlIdsSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";

const ROOT = process.cwd();
const CFG = fantraxLeagueArg(process.argv.slice(2), "check:league");
const P = fantraxPaths(CFG, ROOT);
const EXPECTED_TEAMS = CFG.teams;
const EXPECTED_SCORING_PERIODS = CFG.cadence.scoringPeriods;
/** Daily lineup periods: allow a season already under way to have fewer. */
const MIN_ROSTER_PERIODS = Math.floor(0.8 * CFG.cadence.rosterPeriods);
/**
 * Share of this repo's projections that must be attached to a Fantrax id of the
 * league (`values.json` `src: "proj"`). This is the gate that catches broken
 * NAME MATCHING, and unlike the ACTIVE ratio below no roster shape can move it:
 * it compares two files, neither of which knows who started last night.
 * Measured 2026-09-27: Captains 1,294/1,311 (98.7%), Slapshot 1,288/1,311
 * (98.2%) — the shortfall is players no Fantrax league lists at all.
 */
const MIN_PROJECTIONS_MATCHED = 0.9;
/** Reported (as a warning) whenever a league's ACTIVE match falls under this. */
const IDEAL_ACTIVE_MATCH = 0.95;
const STALE_WARN_HOURS = 36;
/** Explorer pool: floor on size and prospects, ceiling on the file (it is fetched on /league). */
const MIN_POOL_PLAYERS = 1500;
const MIN_POOL_PROSPECTS = 300;
const MAX_POOL_BYTES = 750_000;

const errors: string[] = [];
const warnings: string[] = [];

/** `label` is the repo-relative path, so a second league's failures name its own files. */
function load<T>(path: string): T | null {
  const label = path.slice(ROOT.length + 1).split(/[\\/]/).join("/");
  if (!existsSync(path)) {
    errors.push(`${label} is missing — run npm run league:sync -- --league ${CFG.slug}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch (e) {
    errors.push(`${label} is not valid JSON: ${e}`);
    return null;
  }
}

const league = load<LeagueSnapshot>(P.league);
const nhlIds = load<NhlIdsSnapshot>(P.nhlIds);
const today = load<{ teamId: string; generatedAt: string }>(P.today);
const overrides = load<{ overrides: Array<{ fantraxId: string; nhlId: number | null }> }>(P.overrides);
const values = load<ValuesSnapshot>(P.values);
const state = load<StateSnapshot>(P.state);
const schedule = load<ScheduleSnapshot>(P.schedule);
const pool = load<PoolSnapshot>(P.pool);

if (league) {
  if (league.leagueId !== CFG.leagueId) {
    errors.push(`league.json is league ${league.leagueId} (config says ${CFG.leagueId} for ${CFG.slug})`);
  }
  if (league.teams.length !== EXPECTED_TEAMS) {
    errors.push(`league has ${league.teams.length} teams (expected ${EXPECTED_TEAMS})`);
  }
  const syncedSlots = Object.keys(league.slotCounts).sort().join(",");
  const configSlots = [...CFG.slots.order].sort().join(",");
  if (syncedSlots !== configSlots) {
    errors.push(`league.json has slots ${syncedSlots} (config: ${configSlots})`);
  }
  for (const s of CFG.slots.order) {
    if (league.slotCounts[s] !== CFG.slots.counts[s]) {
      errors.push(`slot ${s} count is ${league.slotCounts[s]} (expected ${CFG.slots.counts[s]})`);
    }
  }
  const activeSlots = CFG.slots.order.reduce((n, s) => n + (league.slotCounts[s] ?? 0), 0);
  if (activeSlots !== league.limits.maxActive) {
    errors.push(`${activeSlots} active slots but maxActive ${league.limits.maxActive}`);
  }
  // The limits fxea does not publish come from the league's rules (its
  // config): a baked league.json from before a rule change must be re-synced.
  for (const k of ["minTotal", "maxIr", "maxMinors", "maxTotal"] as const) {
    if (league.limits[k] !== CFG.limits[k]) {
      errors.push(`limits.${k} is ${league.limits[k]} in league.json, ${CFG.limits[k]} in the config — run npm run league:sync -- --league ${CFG.slug}`);
    }
  }
  if (league.scoringPeriods.length !== EXPECTED_SCORING_PERIODS) {
    errors.push(`${league.scoringPeriods.length} scoring periods (expected ${EXPECTED_SCORING_PERIODS})`);
  }
  if (CFG.features.gamesCaps) {
    const noCaps = league.scoringPeriods.filter((p) => !(p.gpMax! > 0) || !(p.gsMax! > 0));
    if (noCaps.length > 0) {
      errors.push(`${noCaps.length} scoring periods without GP/GS caps (e.g. #${noCaps[0]!.number})`);
    }
  } else if (league.capsSource !== "none") {
    errors.push(`capsSource is ${league.capsSource} for a league without games caps`);
  }
  const badDates = [...league.scoringPeriods, ...league.rosterPeriods].filter(
    (p) => !Number.isFinite(Date.parse(p.start)) || !Number.isFinite(Date.parse(p.end)) || p.start >= p.end,
  );
  if (badDates.length > 0) errors.push(`${badDates.length} periods with invalid ISO dates`);
  if (league.rosterPeriods.length < MIN_ROSTER_PERIODS) {
    errors.push(
      `only ${league.rosterPeriods.length} lineup periods (expected ~${CFG.cadence.rosterPeriods} daily periods)`,
    );
  }
  const shape = scoringShape(league.scoring);
  // A category the value model has no rate for would be dropped silently.
  const unscored = unscoredCategories(league.scoring);
  if (unscored.length > 0) {
    errors.push(`scoring has categories the value model ignores: ${unscored.join(", ")}`);
  }
  if (CFG.features.captainSlot) {
    if (!shape.uniformSkt) warnings.push("Skt multiplier differs across categories — captain math is approximate");
    if (!(league.sktMultiplier > 1)) errors.push(`sktMultiplier is ${league.sktMultiplier} (captain slot missing?)`);
  } else if (league.sktMultiplier !== 1) {
    errors.push(`sktMultiplier is ${league.sktMultiplier} for a league without a captain slot`);
  }
  // The stored {off, dx} pair models three columns of the scoring table:
  // the league's `baseSlot` (off), D (off + dx) and Skt (off x multiplier).
  // Every OTHER slot the league has must score a skater exactly like
  // `baseSlot`, or its starters would be valued off the wrong column.
  // Slots the league does not have are irrelevant, however many rows Fantrax
  // publishes for them (Slapshot's per-slot Hit / SB zeros are the point:
  // they are what makes its `baseSlot` "C" instead of the unreachable
  // "Default", and once read that way C, LW and RW agree exactly).
  for (const d of unmodeledSlots(league.scoring, CFG)) {
    errors.push(
      `slot ${d.slot} scores ${d.category} at ${d.points} but the {off, dx} model reads ${d.base} (baseSlot ${CFG.baseSlot}): it needs per-slot values`,
    );
  }
  // A row every slot of the league scores 0 on is dead configuration. Not an
  // error (Fantrax keeps such rows), but worth naming: it is exactly the
  // shape that made Hit 0.15 / SB 0.3 look live on Slapshot.
  const dead = deadCategories(league.scoring, CFG);
  if (dead.length > 0) {
    warnings.push(`categories configured but unreachable in every slot (worth 0 here): ${dead.join(", ")}`);
  }
}

// ---- the league's position groups: the vocabulary its pool, its position
// filter and its VONA cards speak. A group outside FANTRAX_GROUPS could never
// be parsed back out of a URL, and a group that is a substring of another would
// make a concatenated "pos" string ambiguous.
{
  const groups = CFG.eligibility.groups;
  if (groups.length === 0) errors.push("eligibility.groups is empty: nothing could be ranked");
  for (const g of groups) {
    if (!FANTRAX_GROUPS.includes(g)) errors.push(`group ${g} is not in FANTRAX_GROUPS (the cross-league vocabulary)`);
    if (!CFG.eligibility.groupTokens[g]?.length) errors.push(`group ${g} has no eligiblePos token`);
    for (const h of groups) {
      if (g !== h && h.includes(g)) {
        errors.push(`group ${g} is a substring of ${h}: a pool "pos" string could not be parsed back`);
      }
    }
  }
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
  // Every token of the league's own player universe must land in a group: one
  // that does not drops the player out of the pool and out of every VONA group,
  // silently.
  const ungrouped = new Map<string, string>();
  for (const [id, r] of Object.entries(values.players)) {
    if (eligibleGroups(r.e, CFG).length === 0) ungrouped.set(r.e, id);
  }
  if (ungrouped.size > 0) {
    const shown = [...ungrouped].slice(0, 5).map(([e, id]) => `"${e}" (${id})`).join(", ");
    errors.push(`eligiblePos values in no group of ${CFG.slug}: ${shown}`);
  }
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
  // The name-match gate. players.json is the same file for every league, so the
  // share of its projections that reached a Fantrax id is a property of the
  // MATCHING alone: no draft, roster shape or trade can move it.
  try {
    const projected = (JSON.parse(readFileSync(P.players, "utf8")) as { players: unknown[] }).players.length;
    const attached = Object.values(values.players).filter((r) => r.src === "proj").length;
    const share = projected > 0 ? attached / projected : 0;
    if (share < MIN_PROJECTIONS_MATCHED) {
      errors.push(
        `only ${attached}/${projected} of our projections reached a Fantrax id (${(100 * share).toFixed(1)}%, floor ${100 * MIN_PROJECTIONS_MATCHED}%): name matching looks broken`,
      );
    }
  } catch (e) {
    errors.push(`could not read src/data/players.json to check name matching: ${e}`);
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
  // The floor is a property of the league's ROSTER SHAPE, read from its config,
  // never of the draft clock. A league with Minors slots parks its unprojected
  // prospects there, so 95% of its ACTIVE players are NHL regulars; a league
  // without them (Slapshot: no Minors slot, 32 junior keepers, 38 rounds) has to
  // leave them ACTIVE, and the draft ENDING does not change that — keying the
  // relaxed floor to "a pick is still open" would have snapped it back to 95% on
  // the last pick of the draft and failed every deploy of the whole site.
  const floor = CFG.minActiveMatch;
  const share = active.length > 0 ? matched / active.length : 1;
  const pct = (100 * share).toFixed(1);
  if (active.length > 0 && share < floor) {
    errors.push(`ACTIVE projection match ${matched}/${active.length} (${pct}%) below this league's floor of ${floor * 100}%`);
  } else if (active.length > 0 && share < IDEAL_ACTIVE_MATCH) {
    warnings.push(
      `only ${matched}/${active.length} ACTIVE players are projected (${pct}%) — expected while unprojected prospects and late picks sit on active rosters (a startup draft seats every pick ACTIVE)`,
    );
  }
  if (!state.fxpaOk && CFG.features.fxpa) warnings.push(`snapshot built without fxpa (${state.fxpaError ?? "unknown error"})`);
  const ageH = (Date.now() - Date.parse(state.fetchedAt)) / 3_600_000;
  if (!Number.isFinite(ageH)) errors.push(`state.fetchedAt is invalid: ${state.fetchedAt}`);
  else if (ageH > STALE_WARN_HOURS) warnings.push(`Fantrax snapshot is ${ageH.toFixed(0)} h old — run npm run league:sync`);
}

if (pool) {
  const size = readFileSync(P.pool).length;
  if (size > MAX_POOL_BYTES) errors.push(`pool.json is ${size} B (budget ${MAX_POOL_BYTES} B)`);
  const players = Array.isArray(pool.players) ? pool.players : [];
  if (pool.v !== 1) errors.push(`pool.json version ${String(pool.v)} (expected 1)`);
  if (players.length < MIN_POOL_PLAYERS) errors.push(`pool has ${players.length} players (expected >= ${MIN_POOL_PLAYERS})`);
  const bySrc = { p: 0, e: 0, n: 0 } as Record<string, number>;
  for (const p of players) bySrc[p.src] = (bySrc[p.src] ?? 0) + 1;
  if (CFG.features.minors && (bySrc.e ?? 0) < MIN_POOL_PROSPECTS) {
    errors.push(`pool has ${bySrc.e ?? 0} prospects (expected >= ${MIN_POOL_PROSPECTS})`);
  }
  const c = pool.counts;
  if (!c || c.total !== players.length || c.projected !== bySrc.p || c.prospects !== bySrc.e || c.other !== bySrc.n) {
    errors.push(`pool counts ${JSON.stringify(c)} disagree with its players`);
  }
  const ids = players.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("pool lists a Fantrax id twice");
  if (ids.some((id, i) => i > 0 && ids[i - 1]! >= id)) errors.push("pool is not sorted by Fantrax id");
  const teamIds = new Set(Object.keys(state?.rosters ?? {}));
  const finite = (x: unknown) => x === undefined || (typeof x === "number" && Number.isFinite(x));
  // `pos` is this league's groups concatenated ("CLW"), so it is checked by
  // round-trip and never character by character: over "LWRW" a per-character
  // test sees an "L" and an "R" that are no group at all.
  const posOk = (pos: string) => {
    const parsed = parseGroups(pos, CFG);
    return parsed.length > 0 && parsed.join("") === pos;
  };
  const bad = players.filter(
    (p) =>
      !p.n ||
      !p.pos ||
      !posOk(p.pos) ||
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
    // …and under the groups THIS league ranks: a pool written with another
    // league's vocabulary would file every winger under a group nothing selects.
    const wrongPos = Object.entries(values.players).filter(([id, r]) => {
      const p = inPool.get(id);
      return p && p.pos !== poolGroups(r.e, CFG);
    });
    if (wrongPos.length > 0) {
      const [id, rec] = wrongPos[0]!;
      errors.push(
        `${wrongPos.length} pool players whose groups disagree with this league's vocabulary (e.g. ${id}: pool "${inPool.get(id)!.pos}", config "${poolGroups(rec.e, CFG)}") — run npm run league:sync -- --league ${CFG.slug}`,
      );
    }
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

// Every NHL-organisation player this league lists (a Fantrax id matched to an
// id of nhl-rosters.json) is in the explorer pool, or named in its
// orgSkipped (Fantrax gives him no position here yet): the pool's
// organisation rule (investigation 2026-09-27: the draftable universe).
const nhlRosters = load<{ players: Array<{ id: number }> }>(P.nhlRosters);
if (nhlIds && pool && nhlRosters) {
  const org = new Set(nhlRosters.players.map((p) => p.id));
  const inPool = new Set(pool.players.map((p) => p.id));
  const skipped = new Set(pool.orgSkipped ?? []);
  const missing = Object.entries(nhlIds.ids).filter(([fid, id]) => org.has(id) && !inPool.has(fid) && !skipped.has(fid));
  if (missing.length > 0) {
    errors.push(`${missing.length} NHL-organisation players missing from pool.json (e.g. ${missing.slice(0, 5).map(([fid, id]) => `${fid} → ${id}`).join(", ")})`);
  }
}

// The stand-alone live draft page (Slapshot): every rostered or drafted player has a row.
if (CFG.slug === "slapshot" && state) {
  const pagePath = `${ROOT}/public/slapshot-draft.html`;
  if (existsSync(pagePath)) {
    const m = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(readFileSync(pagePath, "utf8"));
    let rows: Set<string> | null = null;
    try {
      rows = m ? new Set((JSON.parse(m[1]!) as { board: Array<{ i: string }> }).board.map((r) => r.i)) : null;
    } catch {
      rows = null;
    }
    if (!rows) errors.push("public/slapshot-draft.html has no readable board");
    else {
      const held = new Set<string>();
      for (const roster of Object.values(state.rosters)) for (const e of roster) held.add(e.id);
      for (const p of state.draft?.picks ?? []) if (p.playerId) held.add(p.playerId);
      const off = [...held].filter((id) => !rows!.has(id));
      if (off.length > 0) errors.push(`${off.length} rostered or drafted players are not on public/slapshot-draft.html (e.g. ${off.slice(0, 5).join(", ")}): run npm run slapshot:draft-page`);
    }
  }
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

// ---- dynasty values (optional file for the Captains profile; gated when
// present; REQUIRED for the Slapshot profile, whose draft and cap views are
// built on it; forbidden for a league whose config has no keeper-forever model)
const dynastyPath = P.dynasty;
const dynastyLabel = `${CFG.paths.public}/dynasty.json`;
let dynastyNote = CFG.features.dynasty ? "no dynasty.json" : "no dynasty model";
if (!CFG.features.dynasty) {
  if (existsSync(dynastyPath)) {
    errors.push(`${dynastyLabel} exists but ${CFG.slug} has no keeper-forever model (features.dynasty: false)`);
  }
} else if (CFG.dynastyProfile === "slapshot") {
  if (!existsSync(dynastyPath)) {
    errors.push(`${dynastyLabel} is missing — run npm run dynasty:build -- --league ${CFG.slug} (required: every player carries over and the cap views read it)`);
  } else {
    const r = checkSlapshotDynasty(dynastyPath);
    dynastyNote = r.note;
    errors.push(...r.errors.map((e) => `dynasty: ${e}`));
    warnings.push(...r.warnings.map((w) => `dynasty: ${w}`));
  }
} else if (!existsSync(dynastyPath)) {
  warnings.push(`${dynastyLabel} is missing — run npm run dynasty:build (the page falls back to season values)`);
} else if (values && state) {
  let dynasty: DynastySnapshot | null = null;
  try {
    dynasty = JSON.parse(readFileSync(dynastyPath, "utf8")) as DynastySnapshot;
  } catch (e) {
    errors.push(`${dynastyLabel} is not valid JSON: ${e}`);
  }
  if (dynasty) {
    const benchPath = P.dynastyBenchmarks;
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

if (today && today.teamId !== CFG.defaultTeamId) {
  errors.push(`today.json is for ${today.teamId} (expected default team ${CFG.defaultTeamId})`);
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: Fantrax snapshot ${CFG.slug} — ${Object.keys(values?.players ?? {}).length} value records, ${pool?.counts.total ?? 0} pool players (${pool?.counts.prospects ?? 0} prospects), ${schedule?.games.length ?? 0} games, synced ${state?.fetchedAt}; ${dynastyNote}`,
);

/**
 * The Slapshot profile's dynasty.json (scripts/dynasty-slapshot.ts): the
 * schema the draft, player and cap views read, the cap rule (the file's
 * first-season cap must be the config's), a finite non-negative λ, unique
 * ranks, and coverage of the players this league has rostered or drafted.
 */
function checkSlapshotDynasty(path: string): { errors: string[]; warnings: string[]; note: string } {
  const errs: string[] = [];
  const warns: string[] = [];
  type Rec = {
    n?: string;
    dv?: Record<string, number>;
    rank?: Record<string, number>;
    eG?: number[];
    contract?: { cap?: number[]; signed?: number };
    explanation?: string;
  };
  type Snap = {
    version?: number;
    league?: { id?: string };
    inputs?: { poolFetchedAt?: string; projectionsAt?: string };
    params?: { T?: number; lambda?: number[]; cap?: { league?: number[] } };
    players?: Record<string, Rec>;
    zero?: string[];
  };
  let s: Snap;
  try {
    s = JSON.parse(readFileSync(path, "utf8")) as Snap;
  } catch (e) {
    return { errors: [`not valid JSON: ${e}`], warnings: [], note: "dynasty.json unreadable" };
  }
  const players = s.players ?? {};
  const recs = Object.values(players);
  if (s.version !== 1) errs.push(`version ${s.version} (expected 1)`);
  if (s.league?.id !== CFG.leagueId) errs.push(`league ${s.league?.id} (expected ${CFG.leagueId})`);
  if (recs.length < 800) errs.push(`only ${recs.length} players`);
  const T = s.params?.T ?? 0;
  const lambda = s.params?.lambda ?? [];
  if (lambda.length !== T || !lambda.every((x) => Number.isFinite(x) && x >= 0)) errs.push("λ is not one finite value ≥ 0 per season");
  const cap0 = s.params?.cap?.league?.[0];
  if (CFG.salaryCap && cap0 !== CFG.salaryCap.base) errs.push(`first-season cap ${cap0} M$ (config says ${CFG.salaryCap.base})`);
  const bad = recs.filter(
    (r) =>
      !r.n ||
      !r.dv ||
      !r.rank ||
      !Array.isArray(r.eG) ||
      r.eG.length !== T ||
      !Array.isArray(r.contract?.cap) ||
      r.contract!.cap!.length !== T ||
      ![...Object.values(r.dv), ...r.eG, ...r.contract!.cap!].every(Number.isFinite) ||
      !r.explanation,
  );
  if (bad.length) errs.push(`${bad.length} malformed records (${bad.slice(0, 3).map((r) => r.n).join(", ")})`);
  for (const m of ["winNow", "balanced", "longTerm"]) {
    const ranks = recs.map((r) => r.rank?.[m]);
    if (new Set(ranks).size !== ranks.length) errs.push(`${m} ranks are not unique`);
  }
  // Coverage: whoever is on a roster or was drafted must have a value (or a zero entry).
  const zero = new Set(s.zero ?? []);
  const held = new Set<string>();
  for (const roster of Object.values(state?.rosters ?? {})) for (const e of roster) held.add(e.id);
  for (const p of state?.draft?.picks ?? []) if (p.playerId) held.add(p.playerId);
  const covered = [...held].filter((id) => players[id] || zero.has(id)).length;
  const share = held.size ? covered / held.size : 1;
  if (share < 0.9) errs.push(`only ${covered}/${held.size} rostered or drafted players have a dynasty value`);
  else if (share < 0.97) warns.push(`${held.size - covered} rostered or drafted players have no dynasty value (${covered}/${held.size})`);
  if (state && s.inputs?.poolFetchedAt) {
    const lagH = (Date.parse(state.fetchedAt) - Date.parse(s.inputs.poolFetchedAt)) / 3_600_000;
    if (!(lagH < 48)) {
      warns.push(`built on rosters of ${s.inputs.poolFetchedAt}, ${Number.isFinite(lagH) ? lagH.toFixed(0) : "?"} h before state.json — run npm run league:sync -- --league ${CFG.slug}`);
    }
  }
  if (values && s.inputs?.projectionsAt && s.inputs.projectionsAt !== values.projectionsAt) {
    warns.push(`built on projections ${s.inputs.projectionsAt} (values.json has ${values.projectionsAt})`);
  }
  // The baked plan carries the team's cap use (the home card and the first paint read it).
  if (CFG.salaryCap && today && !(today as { salary?: unknown }).salary) {
    errs.push("today.json has no salary block (the sync builds it from the dynasty contracts)");
  }
  return {
    errors: errs,
    warnings: warns,
    note: `dynasty ${recs.length} players (λ ${lambda[0]} pts/M$, cap ${cap0} M$, ${covered}/${held.size} held players valued)`,
  };
}
