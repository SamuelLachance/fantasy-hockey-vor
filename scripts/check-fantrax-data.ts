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
    dynastyNote = `dynasty ${Object.keys(dynasty.players).length} players (K ${dynasty.params?.K?.value})`;
  }
}

// /league is public: the baked files may name teams but never their owners.
for (const [label, data] of Object.entries({ league, today, state, values })) {
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
  `OK: Fantrax snapshot — ${Object.keys(values?.players ?? {}).length} value records, ${schedule?.games.length ?? 0} games, synced ${state?.fetchedAt}; ${dynastyNote}`,
);
