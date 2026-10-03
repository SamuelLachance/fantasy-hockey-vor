/**
 * Smoke checks for the composed daily plan on the committed Fantrax
 * snapshot: structural invariants only (the data changes every sync), plus
 * synthetic rosters for the legality advice, the claim-week reset, the cap
 * projection and the fxpa-down degraded mode.
 * Run: npx tsx scripts/test-fantrax-daily-plan.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { CAPTAINS_DYNASTY, eligibleSlots, FANTRAX_DEFAULT_TEAM_ID, IR_ELIGIBLE_ICONS, NHL_SEASON_ID, SLAPSHOT, waiverMinDelta } from "../src/lib/fantrax/config";
import { buildDailyPlan, type DailyPlan, type PlanInputs } from "../src/lib/fantrax/daily-plan";
import { PLAN_KIT } from "../src/lib/fantrax/plan-kit";
import { rosterPeriodsIn, torontoDateOfIso } from "../src/lib/fantrax/dates";
import { isRuledOut } from "../src/lib/fantrax/points-model";
import { skaterSlotValue } from "../src/lib/fantrax/scoring";
import type { SlotId } from "../src/lib/fantrax/config";
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
const eq3 = (a: number, b: number, msg: string) => assert(near(a, b, 1e-9), `${msg} (${a} vs ${b})`);
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
assert(plan.waivers.minDelta === 3, `Captains keeps its 3-point bar (${plan.waivers.minDelta})`);
assert(plan.waivers.targets.every((t) => t.delta >= 3), "waiver targets clear the 3 FP bar");
// Ranked on the season (this period + the rest), never a net loss, and a
// target that costs points after the period says so.
assert(plan.waivers.targets.every((t) => t.delta + t.ros >= -0.05), "no target loses points over the season");
assert(plan.waivers.targets.every((t) => (t.rental === true) === t.ros < 0), "rental <=> negative rest of season");
assert(
  plan.waivers.targets.every((t, i, a) => i === 0 || a[i - 1]!.delta + a[i - 1]!.ros >= t.delta + t.ros - 0.11),
  "targets ranked by period + rest-of-season gain",
);
assert(plan.goalies.every((g) => g.pStart >= 0 && g.pStart <= 1), "P(start) in [0, 1]");
for (const id of [...plan.legality.fixes, ...plan.legality.reserveFills, ...plan.waivers.targets.map((t) => t.id)]) {
  assert(!!plan.players[id], `referenced player ${id} carried in players`);
}
assert(!("locks" in plan), "a period-lock league's plan carries no per-game locks (Captains' today.json unchanged)");
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
  // A live roster can already hold more (Southern Shore Breakers had 6 Reserve
  // players on 2026-09-28, before the first lock): the advice never adds to it then.
  assert(
    toReserve(p) === 0 || L.counts.reserve + toReserve(p) <= limits.maxReserve,
    `${tag}: the advice keeps Reserve within ${limits.maxReserve}`,
  );
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

// ---- game lock (Slapshot: each player locks 5 min before his own game)
{
  const sState = load<StateSnapshot>("public", "fantrax", "slapshot", "state.json");
  const sValues = load<ValuesSnapshot>("public", "fantrax", "slapshot", "values.json");
  const sLeague = load<LeagueSnapshot>("src", "data", "fantrax", "slapshot", "league.json");
  const sSchedule = load<ScheduleSnapshot>("public", "fantrax", "slapshot", `schedule-${NHL_SEASON_ID}.json`);
  const team = SLAPSHOT.defaultTeamId;
  // Opening night (lineup period 1): FLA-CAR 21:00Z first, CHI-VGK 02:30Z last.
  const first = sSchedule.games.find(([, a, h]) => a === "FLA" && h === "CAR")!;
  const last = sSchedule.games.find(([, a, h]) => a === "CHI" && h === "VGK")!;
  assert(first[0] === "2026-09-29T21:00:00Z" && last[0] === "2026-09-30T02:30:00Z", "opening night in the committed schedule");
  const lead = 5 * 60_000;
  const lastLock = Date.parse(last[0]) - lead;
  // two extra players on my roster from the first game: one Active in C, one on Reserve
  const pick = (t: string, not: string[] = []) =>
    Object.entries(sValues.players).find(([id, r]) => r.t === t && r.src === "proj" && !r.e.split(",").includes("G") && !not.includes(id))![0];
  const car = pick("CAR");
  const fla = pick("FLA");
  const roster: RosterEntry[] = [
    ...(sState.rosters[team] ?? []).filter((r) => r.id !== car && r.id !== fla),
    { id: car, status: "ACTIVE", slot: "C" },
    { id: fla, status: "RESERVE", slot: "RESERVE" },
  ];
  const sInput: PlanInputs = {
    league: sLeague,
    state: { ...sState, rosters: { ...sState.rosters, [team]: roster } },
    values: sValues,
    schedule: sSchedule,
    teamId: team,
    nowMs: Date.parse("2026-09-29T12:00:00Z"),
    config: SLAPSHOT,
    kit: PLAN_KIT,
  };
  // Without the kit a game-lock league is refused, never planned without its locks.
  let refused = false;
  try {
    buildDailyPlan({ ...sInput, kit: undefined });
  } catch {
    refused = true;
  }
  assert(refused, "game lock without the plan kit: an error, not a plan without locks");
  const morning = buildDailyPlan(sInput);
  assert(morning.target?.rosterPeriod === 1 && !!morning.locks, "game lock: the plan carries the per-game locks");
  assert(morning.locks!.next === new Date(Date.parse(first[0]) - lead).toISOString(), `next lock = my first player's game − 5 min (${morning.locks!.next})`);
  assert(morning.locks!.last === new Date(lastLock).toISOString() && morning.locks!.locked.length === 0, "last lock of the night, nobody locked yet");
  // After the first puck drop: the same night is still the target (VGK plays at 22:30 EDT)
  const evening = buildDailyPlan({ ...sInput, nowMs: Date.parse("2026-09-29T21:30:00Z") });
  assert(evening.target?.rosterPeriod === 1, `still tonight's lineup after the first game (target ${evening.target?.rosterPeriod})`);
  assert(evening.locks!.locked.includes(car) && evening.locks!.locked.includes(fla), "the first game's players are locked");
  // The next lock is my next player's game of the night − 5 min: the VGK game
  // at the latest, earlier once the (live-drafted, committed) roster has a
  // player in a game between the first and the last one.
  const eveningMs = Date.parse("2026-09-29T21:30:00Z");
  const rosterTeams = new Set(roster.map((r) => sValues.players[r.id]?.t).filter((t): t is string => !!t));
  const aheadLocks = sSchedule.games
    .filter(([at, a, h]) => (rosterTeams.has(a) || rosterTeams.has(h)) && Date.parse(at) >= Date.parse(first[0]) && Date.parse(at) <= Date.parse(last[0]))
    .map(([at]) => Date.parse(at) - lead)
    .filter((t) => t > eveningMs);
  const nextExpected = Math.min(...aheadLocks);
  assert(nextExpected <= lastLock, "the VGK game is on my roster's night");
  assert(evening.locks!.next === new Date(nextExpected).toISOString(), `next lock = my next player's game − 5 min (${evening.locks!.next})`);
  const slots = evening.lineup!.slots;
  assert(slots.some((x) => x.slot === "C" && x.id === car), "a locked Active player keeps his slot");
  assert(!slots.some((x) => x.id === fla), "a locked Reserve player cannot come in");
  assert(!evening.lineup!.moves.some((m) => m.id === car || m.id === fla), "no move involves a locked player");
  // Once the night's last game has locked, the plan moves to the next day
  const late = buildDailyPlan({ ...sInput, nowMs: lastLock + 1_000 });
  assert(late.target?.rosterPeriod === 2, `after the last lock → period 2 (${late.target?.rosterPeriod})`);
}

// ---- a waiver target's rest of season is the plan replayed day by day (FX-2)
// Late in the regular season so the replay is short: the plan's `ros` must be
// what re-solving the whole plan each later lineup period, with and without
// the swap, adds up to under each later period's games caps (FX-3: the
// lineup's ACTIVE games count, a period's points stop after the day its cap
// is reached). This checks the seats-filled bookkeeping (waiverCapModel
// "capped"): the replayed lineups leave out the bench, so the plans run with
// the caps feature off and the counter is kept here. The shipped "planned"
// model is measured against plans that do bench by scripts/replay-waivers.ts.
{
  const firstPlayoff = league.playoffs?.firstPeriod ?? Number.POSITIVE_INFINITY;
  const regular = league.scoringPeriods.filter((p) => p.number < firstPlayoff);
  const sp = regular[regular.length - 2]!;
  const noCaps = { ...CAPTAINS_DYNASTY, features: { ...CAPTAINS_DYNASTY.features, gamesCaps: false } };
  const nowMs = Date.parse(sp.start) - 3_600_000;
  const lateState: StateSnapshot = { ...state, fetchedAt: new Date(nowMs).toISOString(), scoringPeriod: sp.number, caps: {}, draft: null };
  const gamesOf = (slot: string, id: string, value: number) => {
    const rec = values.players[id]!;
    if (slot === "G") return value / (rec.gE || 1);
    const perGame = skaterSlotValue(rec.off ?? 0, rec.dx ?? 0, slot as SlotId, league.sktMultiplier, {
      isD: eligibleSlots(rec.e, CAPTAINS_DYNASTY).includes("D"),
    });
    return perGame > 0 ? value / perGame : 0;
  };
  let checked = 0;
  for (const team of league.teams) {
    if (checked >= 2) break;
    const p = buildDailyPlan({ ...input, state: lateState, teamId: team.id, nowMs, waiverCapModel: "capped" });
    const t = p.waivers.targets.find((x) => x.drop);
    if (!t) continue;
    const roster0 = state.rosters[team.id] ?? [];
    const dropped = roster0.find((r) => r.id === t.drop!.id)!;
    const swapped = [...roster0.filter((r) => r.id !== dropped.id), { ...dropped, id: t.id }];
    const after = Date.parse(sp.end);
    const lineupSum = (roster: RosterEntry[], capped: boolean) => {
      let sum = 0;
      let period = -1;
      let gp = 0;
      let gs = 0;
      for (const rp of league.rosterPeriods.filter(
        (x) => Date.parse(x.start) > after && Date.parse(x.start) <= Date.parse(regular[regular.length - 1]!.end),
      )) {
        const at = Date.parse(rp.start) - 60_000;
        const scoring = league.scoringPeriods.find((x) => Date.parse(x.start) <= Date.parse(rp.start) && Date.parse(rp.start) <= Date.parse(x.end))!;
        if (scoring.number !== period) {
          period = scoring.number;
          gp = 0;
          gs = 0;
        }
        const st = { ...lateState, rosters: { ...state.rosters, [team.id]: roster }, fetchedAt: new Date(at).toISOString(), waivers: [] };
        const lineup = buildDailyPlan({ ...input, state: st, teamId: team.id, nowMs: at, waiverRosSampleDays: 0, config: noCaps }).lineup;
        let sk = 0;
        let gl = 0;
        let dgp = 0;
        let dgs = 0;
        for (const s of lineup?.slots ?? []) {
          if (!s.id || !(s.value > 0)) continue;
          if (s.slot === "G") {
            gl += s.value;
            dgs += gamesOf(s.slot, s.id, s.value);
          } else {
            sk += s.value;
            dgp += gamesOf(s.slot, s.id, s.value);
          }
        }
        if (!capped || scoring.gpMax == null || gp < scoring.gpMax) sum += sk;
        if (!capped || scoring.gsMax == null || gs < scoring.gsMax) sum += gl;
        gp += dgp;
        gs += dgs;
      }
      return sum;
    };
    const replay = lineupSum(swapped, true) - lineupSum(roster0, true);
    const blind = lineupSum(swapped, false) - lineupSum(roster0, false);
    // Slot values are rounded to the centime in the plan: a few centimes over a month.
    assert(Math.abs(replay - t.ros) <= 0.3, `${team.name}: ros ${t.ros} = the capped day-by-day replay ${replay.toFixed(2)} (cap-blind ${blind.toFixed(2)})`);
    checked++;
  }
  assert(checked > 0, "late-season plans offer a swap to replay");
  // Quebec's swap, 2026-10-02 snapshot: ros 4.0 = capped replay 4.01, cap-blind 6.02.
}

// ---- the waiver bar is in each league's points and period length (FX-5)
{
  eq3(waiverMinDelta(CAPTAINS_DYNASTY, 7), 3, "Captains: 3 points a week");
  eq3(waiverMinDelta(CAPTAINS_DYNASTY, 13), 3, "Captains: a long period keeps the bar");
  const slapBar = waiverMinDelta(SLAPSHOT, 2);
  assert(slapBar > 0.5 && slapBar < 1.3, `Slapshot: about 1 point (${slapBar})`);
  const sState = load<StateSnapshot>("public", "fantrax", "slapshot", "state.json");
  const sValues = load<ValuesSnapshot>("public", "fantrax", "slapshot", "values.json");
  const sLeague = load<LeagueSnapshot>("src", "data", "fantrax", "slapshot", "league.json");
  const sSchedule = load<ScheduleSnapshot>("public", "fantrax", "slapshot", `schedule-${NHL_SEASON_ID}.json`);
  let withTargets = 0;
  const periods = sLeague.scoringPeriods.slice(2, 6);
  for (const sp of periods) {
    const at = Date.parse(sp.start) - 3_600_000;
    for (const team of sLeague.teams.slice(0, 8)) {
      const p = buildDailyPlan({ league: sLeague, state: { ...sState, fetchedAt: new Date(at).toISOString(), draft: null }, values: sValues, schedule: sSchedule, teamId: team.id, nowMs: at, config: SLAPSHOT, kit: PLAN_KIT });
      assert(near(p.waivers.minDelta, waiverMinDelta(SLAPSHOT, rosterPeriodsIn(sLeague.rosterPeriods, sp).length)), "Slapshot plan uses its own bar");
      if (p.waivers.targets.length) withTargets++;
    }
  }
  const share = withTargets / (periods.length * 8);
  assert(share >= 0.6, `Slapshot's waiver panel is not empty by construction (${(share * 100).toFixed(0)} % of plans with a target)`);
}

if (failed) process.exit(1);
console.log(`OK: fantrax daily plan (${plan.teamName}, ${size} B)`);
