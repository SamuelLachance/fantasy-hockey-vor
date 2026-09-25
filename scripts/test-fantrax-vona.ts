/**
 * Unit checks for the probabilistic draft board: availability odds,
 * expected best at a future pick and VONA (by position and per player),
 * plus a non-degeneracy check on the committed Fantrax snapshot.
 * Run: npx tsx scripts/test-fantrax-vona.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { FANTRAX_DEFAULT_TEAM_ID } from "../src/lib/fantrax/config";
import { buildDailyPlan, PLAN_ODDS_EPS, planOdds, seasonFp, type DailyPlan } from "../src/lib/fantrax/daily-plan";
import {
  availability,
  binomialPmf,
  DEFAULT_RANKED_POOL,
  DRAFT_GROUPS,
  draftOutlook,
  expectedBest,
  goneCutoffs,
  normalCdf,
  rankPool,
  type DraftGroup,
  type DraftOutlook,
  type DraftPickInfo,
  type DraftPoolPlayer,
} from "../src/lib/fantrax/draft";
import { fmtOdds } from "../src/lib/fantrax/league-copy";
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

// ---- building blocks
assert(near(normalCdf(0), 0.5, 1e-7), "Φ(0) = 0.5");
assert(near(normalCdf(1.959964), 0.975, 1e-6), "Φ(1.96) = 0.975");
assert(near(normalCdf(-1.3) + normalCdf(1.3), 1, 1e-9), "Φ(−x) = 1 − Φ(x)");
assert(normalCdf(-8) > 0 && normalCdf(-8) < 1e-14, "tail stays positive and tiny");
for (const [m, s] of [[0, 0.5], [1, 0.5], [9, 0.5], [48, 0.3], [200, 0.9], [5, 0], [5, 1]] as const) {
  const pmf = binomialPmf(m, s);
  assert(pmf.length === m + 1 && near(pmf.reduce((a, b) => a + b, 0), 1, 1e-9), `Binomial(${m}, ${s}) sums to 1`);
}
assert(near(binomialPmf(9, 0.5).reduce((a, p, n) => a + p * n, 0), 4.5, 1e-9), "Binomial mean = s·m");

// ---- availability: 1 with no picks in between, monotonic in rank and picks
for (const r of [1, 2, 5, 30, 300]) {
  assert(availability(r, 0, 0.5) === 1 && availability(r, 0, 1) === 1, `rank ${r}: nobody picks → still there`);
  assert(availability(r, 12, 0) === 1, `rank ${r}: no pool picks → still there`);
}
assert(availability(null, 0, 1) === 1, "no ADP, no picks → still there");
for (const s of [0.3, 0.5, 1]) {
  for (let m = 0; m <= 40; m++) {
    for (let r = 1; r <= 80; r++) {
      const a = availability(r, m, s);
      assert(a >= 0 && a <= 1, `availability in [0, 1] (r ${r}, m ${m}, s ${s})`);
      assert(a <= availability(r + 1, m, s) + 1e-12, `later ADP rank never less available (r ${r}, m ${m}, s ${s})`);
      assert(availability(r, m + 1, s) <= a + 1e-12, `more picks never more available (r ${r}, m ${m}, s ${s})`);
    }
    assert(availability(null, m + 1, s) <= availability(null, m, s) + 1e-12, `no ADP: more picks never more available (m ${m})`);
  }
}
// No ADP ranks behind every ranked player: never more at risk than any.
for (const s of [0.3, 0.5, 1]) {
  for (const m of [1, 2, 6, 16, 32, 40]) {
    const noAdp = availability(null, m, s);
    let worst = 1;
    for (let r = 1; r <= DEFAULT_RANKED_POOL; r++) worst = Math.min(worst, noAdp - availability(r, m, s));
    assert(worst >= -1e-12, `no ADP never less available than a ranked player (m ${m}, s ${s}: ${worst})`);
  }
}
assert(availability(null, 32, 0.5) > 1 - 1e-6, "no ADP: no real risk in a 16-player window");
// The odds add up to the pool picks expected: s·m players gone, no more.
for (const s of [0.3, 0.5, 1]) {
  for (const m of [1, 3, 6, 10, 20, 40]) {
    let gone = 0;
    for (let r = 1; r <= DEFAULT_RANKED_POOL; r++) gone += 1 - availability(r, m, s);
    assert(near(gone, s * m, 1e-6), `Σ P(gone) = s·m (m ${m}, s ${s}: ${gone})`);
  }
}
{
  // Cut-offs: exactly n expected gone after n pool picks; everyone once n reaches the pool.
  const small = rankPool([1, 2, 3, 3, 9]);
  const cut = goneCutoffs(small, 7);
  assert(cut.length === 8 && cut[0] === Number.NEGATIVE_INFINITY, "u_0 = −∞");
  for (let n = 1; n < 5; n++) {
    assert(cut[n]! > cut[n - 1]!, `cut-offs rise (n ${n})`);
    const e = [1, 2, 3, 3, 9].reduce((a, r) => a + normalCdf((cut[n]! - Math.log(r + 5)) / 0.35), 0);
    assert(near(e, n, 1e-6), `n = ${n}: ${e} expected gone`);
  }
  assert(cut.slice(5).every((u) => u === Number.POSITIVE_INFINITY), "whole pool gone once n ≥ its size");
}
assert(availability(1, 10, 1) < 0.01, "ADP-first player is gone after ten pool picks");
{
  // One pool pick: the ADP-first player is the likeliest to go, not a lock.
  const gone1 = 1 - availability(1, 1, 1);
  assert(gone1 > 0.3 && gone1 < 0.5 && gone1 > 1 - availability(2, 1, 1), `one pool pick: ADP-first ${gone1} gone`);
}
assert(availability(40, 10, 1) > 0.99, "deep ADP rank survives ten picks");
assert(availability(300, 6, 0.5) > 1 - 1e-9, "300 deep: no real chance of going in six picks");

// ---- expected best
const cands = [
  { id: "a", value: 100, available: 0.5 },
  { id: "b", value: 80, available: 1 },
  { id: "c", value: 60, available: 1 },
];
const eb = expectedBest(cands);
assert(near(eb.value, 0.5 * 100 + 0.5 * 80), `E_best = Σ v·a·Π(1 − a) (${eb.value})`);
assert(eb.topId === "a" && near(eb.topP, 0.5), "ties go to the higher value");
assert(near(expectedBest([...cands].reverse()).value, eb.value), "order-independent");
assert(near(expectedBest(cands.map((c) => ({ ...c, available: 1 }))).value, 100), "everyone there → the best value");
assert(near(expectedBest(cands.map((c) => ({ ...c, available: 0 }))).value, 60), "everyone gone → floored at the deepest");
assert(expectedBest([]).value === 0 && expectedBest([]).topId === null, "empty position");
{
  // Pseudo-random candidate sets: E_best never exceeds the best value.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 200; k++) {
    const set = Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({
      id: `p${i}`,
      value: 50 + rnd() * 300,
      available: rnd(),
    }));
    const best = Math.max(...set.map((c) => c.value));
    const e = expectedBest(set).value;
    assert(e <= best + 1e-9 && e >= Math.min(...set.map((c) => c.value)) - 1e-9, `E_best within [worst, best] (set ${k})`);
  }
}

// ---- VONA: a steep position with others drafting ahead
// Fixed order, 12 teams, me at #6 and #18; five picks made. The top of the
// ADP board is low-value filler; the real value sits just behind it.
const picks: DraftPickInfo[] = Array.from({ length: 24 }, (_, i) => ({
  pick: i + 1,
  round: i < 12 ? 1 : 2,
  teamId: i === 5 || i === 17 ? "me" : `t${i % 12}`,
  ...(i < 5 ? { playerId: `gone${i}` } : {}),
}));
const pool: DraftPoolPlayer[] = [
  ...Array.from({ length: 5 }, (_, i) => ({ id: `gone${i}`, groups: ["W"] as DraftGroup[], seasonFp: 150, adp: i + 1 })),
  ...Array.from({ length: 6 }, (_, i) => ({ id: `fill${i}`, groups: ["W"] as DraftGroup[], seasonFp: 120, adp: 10 + i })),
  // C: one star (ADP rank 7), then a cliff.
  { id: "cStar", groups: ["C"], seasonFp: 300, adp: 20 },
  { id: "cDepth1", groups: ["C"], seasonFp: 240, adp: 80 },
  { id: "cDepth2", groups: ["C"], seasonFp: 235, adp: 90 },
  // W: flat.
  { id: "w1", groups: ["W"], seasonFp: 262, adp: 21 },
  { id: "w2", groups: ["W"], seasonFp: 260, adp: 82 },
  { id: "w3", groups: ["W"], seasonFp: 259, adp: 92 },
  // D: flat and deep.
  { id: "d1", groups: ["D"], seasonFp: 220, adp: 60 },
  { id: "d2", groups: ["D"], seasonFp: 219, adp: 95 },
  // G: nobody ranked (no ADP).
  { id: "g1", groups: ["G"], seasonFp: 200, adp: Number.POSITIVE_INFINITY },
  { id: "g2", groups: ["G"], seasonFp: 150, adp: Number.POSITIVE_INFINITY },
  // Dual C/W: measured where his expected replacement is weakest.
  { id: "cw", groups: ["C", "W"], seasonFp: 230, adp: 150 },
];
function checkSteep(o: DraftOutlook, label: string) {
  const v = o.vona;
  assert(v.C.vona! > 5, `${label}: steep C has a real VONA (${v.C.vona})`);
  assert(v.C.vona! > v.W.vona! && v.C.vona! > v.D.vona! && v.C.vona! > v.G.vona!, `${label}: C outranks the flat positions`);
  assert(DRAFT_GROUPS.every((g) => v[g].vona! >= -1e-9), `${label}: VONA by position is never negative`);
  assert(DRAFT_GROUPS.every((g) => v[g].later <= v[g].now + 1e-9), `${label}: expected best only drops`);
  const rowOf = (id: string) => o.board.find((b) => b.id === id)!;
  for (const b of o.board) {
    assert(near(b.vona!, b.value - v[b.vonaGroup!].later), `${label}: ${b.id} VONA = value − E_best later`);
  }
  assert(rowOf("cStar").vona! > 5 && rowOf("cStar").vonaGroup === "C", `${label}: the C star has a positive VONA`);
  assert(rowOf("cDepth2").vona! < 0 && rowOf("g2").vona! < 0, `${label}: players below the expected replacement are negative`);
  const cwGroup = v.C.later < v.W.later ? "C" : "W";
  assert(rowOf("cw").vonaGroup === cwGroup, `${label}: dual C/W measured where the replacement is weakest`);
  assert(
    o.board.every((b) => rowOf("g1").available >= b.available - 1e-12),
    `${label}: unranked goalie never more at risk than a ranked player`,
  );
  if (o.picksBefore > 0) {
    // The whole available pool is on the board here (boardSize 30).
    const gone = o.board.reduce((a, b) => a + 1 - b.available, 0);
    assert(near(gone, o.poolShare * o.picksBefore, 1e-6), `${label}: ${gone} expected gone = s·m`);
  }
  assert(o.board.every((b) => b.likelyGone === b.available < 0.5), `${label}: likelyGone mirrors the odds at 50%`);
  const vonas = new Set(o.board.map((b) => b.vona!.toFixed(3)));
  assert(vonas.size > 5, `${label}: per-player VONA differs player to player`);
}
const out = draftOutlook(picks, "me", pool, {}, { poolShare: 0.6, boardSize: 30 });
const r = (id: string) => out.board.find((b) => b.id === id)!;
assert(out.picksBefore === 0 && out.picksBeforeFollowing === 11, "on the clock at #6, 11 picks to #18");
checkSteep(out, "on the clock");
assert(near(out.vona.C.now, 300) && out.vona.C.bestP === 1 && r("cStar").available === 1, "on the clock: the star is there now");
assert(out.vona.C.laterId === "cStar" && out.vona.C.laterP < 0.6, "the star may not last to #18");
{
  // Not on the clock: one more pick made; me at #18, then #25.
  const later = draftOutlook(
    picks.map((p) => (p.pick === 6 ? { ...p, playerId: "fill0" } : p)).concat([{ pick: 25, round: 3, teamId: "me" }]),
    "me",
    pool,
    {},
    { poolShare: 0.6, boardSize: 30 },
  );
  assert(later.picksBefore === 11 && later.picksBeforeFollowing === 17, "11 picks to #18, 17 to #25");
  checkSteep(later, "mid-round");
  const star = later.board.find((b) => b.id === "cStar")!;
  assert(star.available > 0 && star.available < 1, "odds, not yes/no");
  assert(later.board.find((b) => b.id === "fill1")!.available < star.available, "earlier ADP rank, lower odds");
}

// ---- the committed snapshot gives non-degenerate numbers
{
  const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...p), "utf8")) as T;
  const league = read<LeagueSnapshot>("src", "data", "fantrax", "league.json");
  const state = read<StateSnapshot>("public", "fantrax", "state.json");
  const values = read<ValuesSnapshot>("public", "fantrax", "values.json");
  const schedule = read<ScheduleSnapshot>("public", "fantrax", "schedule-20262027.json");

  const nonDegenerate = (d: NonNullable<DailyPlan["draft"]> | DraftOutlook, label: string) => {
    if (!d.following) return;
    const vs = DRAFT_GROUPS.map((g) => d.vona[g].vona ?? 0);
    assert(vs.some((x) => Math.abs(x) >= 0.1), `${label}: VONA not zero everywhere (${vs.join(", ")})`);
    assert(new Set(d.board.map((b) => b.vona)).size > 1, `${label}: per-player VONA not all equal`);
    assert(d.board.some((b) => (b.vona ?? 0) !== 0), `${label}: per-player VONA not all zero`);
    assert(d.board.every((b) => b.available >= 0 && b.available <= 1), `${label}: odds in [0, 1]`);
    if (d.picksBefore > 0) assert(d.board.some((b) => b.available < 1), `${label}: some risk before the next pick`);
  };

  const nowMs = Date.parse(state.fetchedAt);
  const plan = buildDailyPlan({ league, state, values, schedule, teamId: FANTRAX_DEFAULT_TEAM_ID, nowMs });
  if (plan.draft) nonDegenerate(plan.draft, "snapshot plan");

  // Plan odds never serialize onto a false 0 % / 100 %.
  const noFalseCertainty = (d: NonNullable<DailyPlan["draft"]>, label: string) => {
    const inside = (p: number) => p >= PLAN_ODDS_EPS && p <= 1 - PLAN_ODDS_EPS;
    const shown = (p: number) => fmtOdds(p) !== fmtOdds(0) && fmtOdds(p) !== fmtOdds(1);
    if (d.picksBefore > 0) {
      assert(d.board.every((b) => inside(b.available) && shown(b.available)), `${label}: board odds stay off 0 / 1`);
      assert(DRAFT_GROUPS.every((g) => !d.vona[g].bestId || inside(d.vona[g].bestP)), `${label}: best-now odds stay off 0 / 1`);
    }
    if ((d.picksBeforeFollowing ?? 0) > 0) {
      assert(DRAFT_GROUPS.every((g) => !d.vona[g].laterId || inside(d.vona[g].laterP)), `${label}: best-later odds stay off 0 / 1`);
    }
  };
  if (plan.draft) noFalseCertainty(plan.draft, "snapshot plan");
  if (state.draft) {
    // My next pick 40 other picks away (then 55): the ADP-first players are
    // all but sure to be gone, the deep ones all but sure to last.
    const open = state.draft.picks.filter((p) => !p.playerId).sort((a, b) => a.pick - b.pick);
    if (open.length > 56) {
      const mine = new Set([open[40]!.pick, open[55]!.pick]);
      const far: StateSnapshot = {
        ...state,
        draft: {
          ...state.draft,
          picks: state.draft.picks.map((p) =>
            p.playerId
              ? p
              : { ...p, teamId: mine.has(p.pick) ? FANTRAX_DEFAULT_TEAM_ID : p.teamId === FANTRAX_DEFAULT_TEAM_ID ? "other" : p.teamId },
          ),
        },
      };
      const farPlan = buildDailyPlan({ league, state: far, values, schedule, teamId: FANTRAX_DEFAULT_TEAM_ID, nowMs });
      assert(farPlan.draft?.picksBefore === 40, `far pick: 40 picks before (${farPlan.draft?.picksBefore})`);
      if (farPlan.draft) {
        noFalseCertainty(farPlan.draft, "far pick");
        nonDegenerate(farPlan.draft, "far pick");
      }
    }
  }
  assert(planOdds(4e-6, false) === PLAN_ODDS_EPS && fmtOdds(planOdds(4e-6, false)) === fmtOdds(0.001), "tiny odds stay < 1 %");
  assert(planOdds(0.99996, false) === 1 - PLAN_ODDS_EPS && fmtOdds(planOdds(0.99996, false)) === fmtOdds(0.999), "near-sure odds stay > 99 %");
  assert(planOdds(1, false) === 1 - PLAN_ODDS_EPS && planOdds(0, false) === PLAN_ODDS_EPS, "not sure: never exactly 0 or 1");
  assert(planOdds(1, true) === 1 && planOdds(0.123456, false) === 0.1235, "sure stays 1; four decimals otherwise");

  // Same pool and ADP mid-draft, whatever the draft's state today: 14 teams
  // in fixed order, 16 picks made (half on the top of the ADP board).
  const all: DraftPoolPlayer[] = Object.entries(values.players)
    .filter(([, rec]) => rec.src === "proj")
    .map(([id, rec]) => ({
      id,
      groups: DRAFT_GROUPS.filter((g) => rec.e.split(",").includes(g)),
      seasonFp: seasonFp(rec),
      adp: state.adp[id] ?? Number.POSITIVE_INFINITY,
    }))
    .filter((p) => p.seasonFp > 0 && p.groups.length > 0);
  const byAdp = all.filter((p) => Number.isFinite(p.adp)).sort((a, b) => a.adp - b.adp);
  const sim: DraftPickInfo[] = Array.from({ length: 14 * 16 }, (_, i) => ({
    pick: i + 1,
    round: Math.floor(i / 14) + 1,
    teamId: `t${i % 14}`,
    ...(i < 16 ? { playerId: i % 2 ? `prospect${i}` : byAdp[i]!.id } : {}),
  }));
  const simOut = draftOutlook(sim, "t5", all, { D: 0.5 }, { poolShare: 0.5 });
  assert(simOut.next?.pick === 20 && simOut.following?.pick === 34, "simulated: my picks #20 and #34");
  nonDegenerate(simOut, "snapshot pool, simulated mid-draft");
}

if (failed) {
  console.error(`\n${failed} VONA check(s) failed`);
  process.exit(1);
}
console.log("OK: fantrax draft VONA (availability odds, expected best, snapshot)");
