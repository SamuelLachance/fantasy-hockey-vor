/**
 * Smoke checks for the composed daily plan on the committed Fantrax
 * snapshot: structural invariants only (the data changes every sync), plus
 * synthetic rosters for the legality advice, the claim-week reset, the cap
 * projection and the fxpa-down degraded mode.
 * Run: npx tsx scripts/test-fantrax-daily-plan.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { FANTRAX_DEFAULT_TEAM_ID, IR_ELIGIBLE_ICONS, NHL_SEASON_ID } from "../src/lib/fantrax/config";
import { buildDailyPlan, type DailyPlan, type PlanInputs } from "../src/lib/fantrax/daily-plan";
import { torontoDateOfIso } from "../src/lib/fantrax/dates";
import { isRuledOut } from "../src/lib/fantrax/points-model";
import type { RosterEntry } from "../src/lib/fantrax/roster-rules";
import type {
  LeagueSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;
const load = <T>(...parts: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...parts), "utf8")) as T;

const state = load<StateSnapshot>("public", "fantrax", "state.json");
const values = load<ValuesSnapshot>("public", "fantrax", "values.json");
const league = load<LeagueSnapshot>("src", "data", "fantrax", "league.json");
const input: PlanInputs = {
  league,
  state,
  values,
  schedule: load<ScheduleSnapshot>("public", "fantrax", `schedule-${NHL_SEASON_ID}.json`),
  teamId: FANTRAX_DEFAULT_TEAM_ID,
  nowMs: Date.parse(state.fetchedAt),
};

const plan = buildDailyPlan(input);
assert(plan.teamName.length > 0, "team name resolved");
for (const l of [plan.baseLineup, ...(plan.lineup ? [plan.lineup] : [])]) {
  assert(l.slots.length === 15, "15 lineup slots");
  const ids = l.slots.map((s) => s.id).filter(Boolean);
  assert(new Set(ids).size === ids.length, "nobody placed twice");
  const roster = new Set((state.rosters[FANTRAX_DEFAULT_TEAM_ID] ?? []).map((r) => r.id));
  assert(ids.every((id) => roster.has(id!)), "lineup uses only rostered players");
  assert(l.slots.every((s) => Number.isFinite(s.value) && s.value >= 0), "finite non-negative slot values");
}
assert(plan.legality.fixes.every((id) => plan.legality.movableFromMinors.includes(id) || plan.legality.healthyOnIr.includes(id)), "fixes come from Minors / IR");
assert(plan.waivers.targets.every((t) => t.delta >= 3), "waiver targets clear the 3 FP bar");
assert(plan.goalies.every((g) => g.pStart >= 0 && g.pStart <= 1), "P(start) in [0, 1]");
for (const id of [...plan.legality.fixes, ...plan.legality.reserveFills, ...plan.waivers.targets.map((t) => t.id)]) {
  assert(!!plan.players[id], `referenced player ${id} carried in players`);
}
const size = JSON.stringify(plan).length;
assert(size < 20_000, `plan stays small for the page payload (${size} B)`);

// ---- every team: one after-moves count behind all of the advice
const { limits } = league;
const deadOut = (p: DailyPlan) =>
  Object.values(p.legality.deadMoves).filter((m) => m === "MINORS" || m === "INJURED_RESERVE").length;
const toReserve = (p: DailyPlan) =>
  Object.values(p.legality.fixTo).filter((x) => x === "RESERVE").length +
  p.legality.reserveFills.length +
  Object.values(p.legality.deadMoves).filter((m) => m === "RESERVE").length;
for (const team of league.teams) {
  const p = buildDailyPlan({ ...input, teamId: team.id });
  const L = p.legality;
  const tag = team.name;
  assert(L.fixes.length + L.reserveFills.length + L.shortBy === L.need, `${tag}: fixes + Reserve bodies + shortfall = need`);
  const after = L.counts.counted + L.fixes.length + L.reserveFills.length - deadOut(p);
  assert(after + L.shortBy >= L.minTotal, `${tag}: following every move leaves ${after} counted (+${L.shortBy} short)`);
  if (deadOut(p) > 0) assert(after >= L.minTotal, `${tag}: dead players leave the count only when the roster stays legal`);
  assert(L.counts.reserve + toReserve(p) <= limits.maxReserve, `${tag}: Reserve stays within ${limits.maxReserve}`);
  if (L.shortBy > 0) {
    const bodies = (state.rosters[team.id] ?? []).filter((r) => r.status === "MINORS" || r.status === "INJURED_RESERVE").length;
    assert(
      L.fixes.length + L.reserveFills.length === bodies || L.counts.reserve + toReserve(p) === limits.maxReserve,
      `${tag}: short only once every Minors / IR body is used or Reserve is full`,
    );
  }
  for (const a of p.alerts.filter((x) => x.code === "dead-active")) {
    assert(a.to === L.deadMoves[a.ids![0]!], `${tag}: dead-player alert carries the planned move`);
  }
  assert(
    L.healthyOnIr.every((id) => !(state.icons[id] ?? []).some((i) => IR_ELIGIBLE_ICONS.includes(i))),
    `${tag}: injured / suspended IR players are not "healthy on IR"`,
  );
  for (const s of [...p.baseLineup.slots, ...(p.lineup?.slots ?? [])]) {
    if (!s.id || s.value <= 0) continue;
    assert(!isRuledOut({ team: values.players[s.id]!.t, icons: state.icons[s.id] }), `${tag}: ruled-out ${s.id} scores nothing`);
  }
  // Captain advice agrees with the optimizer (ties aside).
  if (p.captains.length && p.baseLineup.captain) {
    assert(p.captains[0]!.delta === 0 && near(p.captains[0]!.total, p.baseLineup.total, 0.011), `${tag}: best captain = optimal total`);
    assert(p.captains.some((c) => c.id === p.baseLineup.captain!.id && c.delta === 0), `${tag}: optimizer's captain ranks first`);
  }
  if (p.currentCaptain) assert(p.currentCaptain.delta <= 0, `${tag}: switching away from the optimum never gains`);
}

// ---- synthetic legality: a dead active player at exactly 15 counted
const icons = state.icons;
const healthy = Object.entries(values.players)
  .filter(([id, r]) => r.src === "proj" && r.off !== undefined && r.gp >= 60 && !icons[id]?.length && r.t !== "(N/A)")
  .map(([id]) => id);
const minorLeaguers = Object.keys(icons).filter(
  (id) =>
    icons[id]!.includes("4") &&
    icons[id]!.includes("31") &&
    !icons[id]!.some((i) => IR_ELIGIBLE_ICONS.includes(i)) &&
    values.players[id],
);
assert(healthy.length >= 20 && minorLeaguers.length >= 6, "snapshot has enough healthy / minor-league players for the synthetic rosters");
const dead = minorLeaguers[0]!;
const entries = (ids: string[], status: string, slot = "W"): RosterEntry[] => ids.map((id) => ({ id, slot, status }));
const withRoster = (roster: RosterEntry[]) =>
  buildDailyPlan({ ...input, state: { ...state, rosters: { ...state.rosters, [FANTRAX_DEFAULT_TEAM_ID]: roster } } });

const at15 = withRoster([
  ...entries(healthy.slice(0, 10), "ACTIVE"),
  ...entries(healthy.slice(10, 14), "RESERVE"),
  { id: dead, slot: "D", status: "ACTIVE" },
]);
assert(at15.legality.need === 0 && at15.legality.deadMoves[dead] === "RESERVE", "15 counted: the dead player goes to Reserve (still counted), not Minors");
const at16 = withRoster([
  ...entries(healthy.slice(0, 11), "ACTIVE"),
  ...entries(healthy.slice(11, 15), "RESERVE"),
  { id: dead, slot: "D", status: "ACTIVE" },
]);
assert(at16.legality.deadMoves[dead] === "MINORS", "16 counted: the dead player can go down to Minors");

// Short-handed with mostly minor-leaguers in Minors: they fill Reserve
// (counted, not scoring) instead of sending the team to the waiver wire.
const short = withRoster([
  ...entries(healthy.slice(0, 9), "ACTIVE"),
  { id: dead, slot: "D", status: "ACTIVE" },
  ...entries(healthy.slice(9, 11), "MINORS"),
  ...entries(minorLeaguers.slice(1, 5), "MINORS"),
]);
const S = short.legality;
assert(S.need === 5 && S.fixes.length === 2 && S.reserveFills.length === 3 && S.shortBy === 0, `need 5 = 2 playable + 3 Reserve bodies (${S.fixes.length}/${S.reserveFills.length}/${S.shortBy})`);
assert(S.reserveFills.every((id) => minorLeaguers.includes(id)), "Reserve bodies are the minor-leaguers");
assert(S.deadMoves[dead] !== "MINORS", "no surplus: the dead player is not sent out of the count");

// ---- claims reset on Monday even before the next sync
const claimsState: StateSnapshot = {
  ...state,
  claims: { [FANTRAX_DEFAULT_TEAM_ID]: 3 },
  claimsWeekStart: "2026-09-21",
};
const sameWeek = buildDailyPlan({ ...input, state: claimsState, nowMs: Date.parse("2026-09-25T15:00:00Z") });
assert(sameWeek.waivers.claimsUsed === 3 && sameWeek.waivers.claimsLeft === 2, "same claim week: baked count");
const nextWeek = buildDailyPlan({ ...input, state: claimsState, nowMs: Date.parse("2026-09-29T15:00:00Z") });
assert(nextWeek.waivers.claimsUsed === 0 && nextWeek.waivers.claimsLeft === 5, "after the Monday reset: 0 used, 5 left");
assert(nextWeek.waivers.weekStart === "2026-09-28", `claim week starts Monday (${nextWeek.waivers.weekStart})`);

// ---- cap projection: today's slate stays counted after its first puck drop
const sp1 = league.scoringPeriods[0]!;
const firstLock = Date.parse(league.rosterPeriods[0]!.start);
if (Date.parse(state.fetchedAt) < firstLock) {
  const before = buildDailyPlan({ ...input, nowMs: firstLock - 60_000 });
  const after = buildDailyPlan({ ...input, nowMs: firstLock + 60_000 });
  assert(after.target?.rosterPeriod === before.target!.rosterPeriod + 1, "the target moves on at puck drop");
  assert(
    near(after.cap!.projectedGp, before.cap!.projectedGp, 0.051) && near(after.cap!.projectedGs, before.cap!.projectedGs, 0.051),
    `cap projection keeps the day in progress (${before.cap!.projectedGp} → ${after.cap!.projectedGp})`,
  );
}
if (plan.scoringPeriod?.number === 1) {
  // Fantrax labels it "Sep 29/26 - Oct 11/26"; the end instant is Oct 12 12:59 EDT.
  assert(plan.scoringPeriod.firstDay === "2026-09-29" && plan.scoringPeriod.lastDay === "2026-10-11", "period 1 runs Sep 29 → Oct 11");
  assert(torontoDateOfIso(sp1.end) === "2026-10-12", "its end instant falls on Oct 12");
}
const capWith = (gpMax: number) =>
  buildDailyPlan({
    ...input,
    league: { ...league, scoringPeriods: league.scoringPeriods.map((p, i) => (i === 0 ? { ...p, gpMax } : p)) },
  }).cap!;
assert(capWith(1).gpBinds, "a tiny cap binds");
assert(!capWith(10_000).gpBinds, "a huge cap does not");
const base = capWith(10_000);
const lastCol = (plan.week?.days.length ?? 0) - 1;
const deadIds = new Set(plan.legality.dead.map((d) => d.id));
const lastDayGames = (plan.week?.rows ?? []).filter((r) => !deadIds.has(r.id)).reduce((s, r) => s + (r.games[lastCol] ?? 0), 0);
if (plan.scoringPeriod?.number === 1 && lastDayGames > 0) {
  const lastDay = capWith(base.projectedGp - 0.01);
  assert(lastDay.projectedGp >= (lastDay.gpMax ?? 0) && !lastDay.gpBinds, "a cap first crossed on the last day costs nothing");
}

// ---- fxpa down: no icons, so no Minors/IR guesses and a visible warning.
const degraded = buildDailyPlan({ ...input, state: { ...state, fxpaOk: false, icons: {}, caps: {}, ros: {}, claims: null } });
assert(degraded.alerts.some((a) => a.code === "fxpa-down"), "fxpa-down alert");
assert(degraded.legality.fixes.length === 0, "no playable-Minors guesses without icons");
assert(
  degraded.legality.fixes.length + degraded.legality.reserveFills.length + degraded.legality.shortBy === degraded.legality.need,
  "the count itself needs no icons: Minors bodies still fill Reserve",
);
assert(degraded.waivers.claimsLeft === null, "claims unknown");
assert(degraded.cap?.known === false, "cap usage unknown");

if (failed) process.exit(1);
console.log(`OK: fantrax daily plan (${plan.teamName}, ${size} B)`);
