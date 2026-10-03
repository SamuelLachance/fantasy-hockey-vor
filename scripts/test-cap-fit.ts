/**
 * Salary-cap fit (`capFit`, cap-fit.ts): the rules on hand-made rosters, then
 * a guard on the committed Slapshot snapshot — on every team the advice is
 * at least as good over the rest of the season as the roster as it is and
 * as the rule by hand, legal whenever the rule by hand is, and never calls
 * up a prospect projected for no NHL game (unless the roster is under the
 * floor: then his cap hit is the point). The full measure is
 * scripts/backtest-cap-fit.ts (off CI).
 */
import { readFileSync } from "fs";
import { capFit, capFitByHand, countedValue, type CapFitPlayer } from "../src/lib/fantrax/cap-fit";
import { buildDailyPlan, planCapFit, type PlanKit } from "../src/lib/fantrax/daily-plan";
import { PLAN_KIT } from "../src/lib/fantrax/plan-kit";
import { SLAPSHOT, type SlotCounts, type SlotId } from "../src/lib/fantrax/config";
import { seasonFp } from "../src/lib/fantrax/draft-inputs";
import type { LineupCandidate } from "../src/lib/fantrax/lineup";
import { capFitLine } from "../src/lib/fantrax/salary-copy";

/** Lineup solves the fit may run on a committed Slapshot team (median / worst): see the snapshot block. */
const MAX_MEDIAN_SOLVES = 1200;
const MAX_SOLVES = 5000;

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const W1G1: SlotCounts = { C: 0, W: 1, F: 0, D: 0, Skt: 0, G: 1 };
const ORDER: SlotId[] = ["W", "G"];
const w = (id: string, v: number): LineupCandidate => ({ id, eligible: ["W"], status: "RESERVE", values: { W: v }, games: 1 });
const g = (id: string, v: number): LineupCandidate => ({ id, eligible: ["G"], status: "RESERVE", values: { G: v }, games: 1 });
const rules = { cap: 10, floor: 0, spots: 2, maxMinors: 5 };
const W2: SlotCounts = { C: 0, W: 2, F: 0, D: 0, Skt: 0, G: 0 };

// ---- over the cap: the star (9 M$) and a 2 M$ winger make 11 > 10. Two
// cheap wingers (5.5 a day) beat the star alone (5): send the star down.
{
  const players: CapFitPlayer[] = [
    { id: "star", status: "ACTIVE", hit: 9 },
    { id: "b", status: "ACTIVE", hit: 2 },
    { id: "c", status: "MINORS", hit: 2 },
  ];
  const day = [w("star", 5), w("b", 3), w("c", 2.5)];
  const res = capFit(players, rules, [day, day], [1, 1], W2, ["W"]);
  const moves = res.moves.map((m) => `${m.id}>${m.to}`).sort().join();
  assert(moves === "c>RESERVE,star>MINORS", `star down, c up (${moves})`);
  assert(res.legal && Math.abs(res.usedAfter - 4) < 1e-9, `legal at 4 M$ (${res.usedAfter})`);
  assert(Math.abs(res.after - 11) < 1e-9, `2 days x 5.5 (${res.after})`);
}

// ---- the floor: 3 M$ counted under a 6 M$ floor; the call-up that reaches it.
{
  const players: CapFitPlayer[] = [
    { id: "a", status: "ACTIVE", hit: 3 },
    { id: "cheap", status: "MINORS", hit: 1 },
    { id: "vet", status: "MINORS", hit: 4 },
  ];
  const day = [w("a", 3), w("cheap", 2), w("vet", 1)];
  const res = capFit(players, { ...rules, floor: 6 }, [day], [1], W2, ["W"]);
  assert(res.legal && res.moves.some((m) => m.id === "vet" && m.to === "RESERVE"), `the floor calls up the veteran, not the better cheap one (${JSON.stringify(res.moves)})`);
}

// ---- lineup-aware: one goalie seat, already filled by a 4-point goalie. The
// rule by hand calls up the second-best season total (a 3.9 goalie); the fit
// calls up the winger who has a seat (2).
{
  const players: CapFitPlayer[] = [
    { id: "g1", status: "ACTIVE", hit: 1 },
    { id: "g2", status: "MINORS", hit: 1 },
    { id: "w1", status: "MINORS", hit: 1 },
  ];
  const day = [g("g1", 4), g("g2", 3.9), w("w1", 2)];
  const res = capFit(players, rules, [day], [1], W1G1, ORDER);
  assert(res.moves.map((m) => m.id).join() === "w1", `the winger, not a second goalie (${JSON.stringify(res.moves)})`);
  const hand = capFitByHand(players, rules, (id) => ({ g1: 4, g2: 3.9, w1: 2 })[id] ?? 0);
  assert(hand.has("g2") && !hand.has("w1"), "the rule by hand takes the goalie");
  assert(countedValue(new Set(["g1", "w1"]), [day], [1], W1G1, ORDER) > countedValue(hand, [day], [1], W1G1, ORDER), "and scores less");
}

// ---- the words: titled by what the moves fix, no doubled parenthesis.
{
  const line = capFitLine({ moves: [{ id: "a", to: "MINORS" }, { id: "b", to: "MINORS" }, { id: "c", to: "RESERVE" }], usedBefore: 70.9, usedAfter: 73.6, gain: 26.2, legal: true, fix: null }, (id) => id.toUpperCase());
  assert(line.startsWith("Mineures et réserve : ") && !line.includes("plafond"), `a legal roster's moves are not a cap fix: ${line}`);
  assert(line.includes("envoyer A et B aux mineures") && line.includes("rappeler C à la réserve") && line.includes("+26 points"), line);
  assert(!line.includes(") ("), `one parenthesis: ${line}`);
  const fix = capFitLine({ moves: [{ id: "a", to: "MINORS" }], usedBefore: 108, usedAfter: 99, gain: null, legal: true, fix: "cap" }, (id) => id);
  assert(fix.startsWith("Ajustement au plafond : ") && fix.includes("conforme") && !fix.includes("non conforme"), fix);
  assert(capFitLine({ moves: [{ id: "a", to: "RESERVE" }], usedBefore: 65, usedAfter: 71, gain: null, legal: true, fix: "floor" }, (id) => id).startsWith("Ajustement au plancher"), "the floor");
  const spots = capFitLine({ moves: [{ id: "a", to: "MINORS" }], usedBefore: 95, usedAfter: 94, gain: null, legal: false, fix: "spots" }, (id) => id);
  assert(spots.startsWith("Trop de joueurs comptés") && spots.endsWith("M$). L’effectif reste non conforme : il faudra aussi libérer ou ajouter un joueur.") && !spots.includes("))"), spots);
}

// ---- the committed Slapshot snapshot: every team.
{
  const J = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const league = J("src/data/fantrax/slapshot/league.json");
  const state = J("public/fantrax/slapshot/state.json");
  const values = J("public/fantrax/slapshot/values.json");
  const schedule = J("public/fantrax/slapshot/schedule-20262027.json");
  const contracts = J("public/fantrax/slapshot/contracts.json");
  const nowMs = Date.parse(J("src/data/fantrax/slapshot/today.json").generatedAt);
  let advised = 0;
  const cost: Array<{ team: string; solves: number; ms: number }> = [];
  for (const team of league.teams as Array<{ id: string; name: string }>) {
    type Fit = ReturnType<NonNullable<PlanKit["capFit"]>> & { input: Parameters<NonNullable<PlanKit["capFit"]>>[0] };
    let fit: Fit | null = null;
    const kit: PlanKit = {
      ...PLAN_KIT,
      capFit: (input) => {
        const t0 = performance.now();
        const out = PLAN_KIT.capFit!(input);
        cost.push({ team: team.name, solves: out.result.solves, ms: performance.now() - t0 });
        fit = { ...out, input };
        return out;
      },
    };
    const plan = buildDailyPlan({ league, state, values, schedule, teamId: team.id, nowMs, config: SLAPSHOT, kit, contracts });
    if (!fit) continue;
    const { players, days, result: res, rules, input } = fit as Fit;
    const { slots, order } = input;
    const weights = days.map(() => 1);
    const hand = capFitByHand(players, rules, (id) => (values.players[id] ? seasonFp(values.players[id], SLAPSHOT) : 0));
    const handUsed = [...hand].reduce((a, id) => a + (players.find((p) => p.id === id)?.hit ?? 0), 0);
    const minorsNow = players.filter((p) => p.status === "MINORS");
    const handMinors = minorsNow.filter((p) => !hand.has(p.id)).length + players.filter((p) => p.status !== "MINORS" && !hand.has(p.id)).length;
    const handLegal = handUsed <= rules.cap + 1e-9 && handUsed >= rules.floor - 1e-9 && hand.size <= rules.spots && handMinors <= rules.maxMinors;
    const handValue = countedValue(hand, days, weights, slots, order);
    assert(res.after >= res.before - 1e-6 || res.usedBefore > rules.cap || res.usedBefore < rules.floor, `${team.name}: the fit never loses points on a legal roster (${res.after} < ${res.before})`);
    assert(!handLegal || res.legal, `${team.name}: legal whenever the rule by hand is`);
    assert(!handLegal || !res.legal || res.after >= handValue - 1e-6, `${team.name}: at least the rule by hand (${res.after.toFixed(1)} < ${handValue.toFixed(1)})`);
    for (const m of res.moves) {
      // Under the floor, a cheap prospect's cap hit is what is wanted.
      if (m.to !== "RESERVE" || res.usedBefore < rules.floor) continue;
      assert((values.players[m.id]?.gp ?? 0) > 0, `${team.name}: ${values.players[m.id]?.n} is projected for no NHL game and is called up`);
    }
    // The browser's split (FantraxLeagueProvider): the plan without the fit,
    // then the fit alone for the plan's lineup period, gives the same advice.
    const deferred = buildDailyPlan({ league, state, values, schedule, teamId: team.id, nowMs, config: SLAPSHOT, kit: PLAN_KIT, contracts, deferCapFit: true });
    assert(deferred.capFit === undefined, `${team.name}: deferCapFit leaves the fit out`);
    const apart = deferred.target ? planCapFit({ league, state, values, schedule, teamId: team.id, nowMs: 0, config: SLAPSHOT, kit: PLAN_KIT, contracts }, deferred.target.rosterPeriod) : null;
    assert(JSON.stringify(apart) === JSON.stringify(plan.capFit), `${team.name}: planCapFit = the plan's capFit`);
    if (plan.capFit) {
      advised++;
      // One card, one payroll: the fit's « before » is the salary line's.
      assert(Math.abs(plan.capFit.usedBefore - (plan.salary?.used[0] ?? NaN)) < 0.011, `${team.name}: fit payroll ${plan.capFit.usedBefore} = salary line ${plan.salary?.used[0]}`);
      assert((plan.capFit.fix === "cap") === !!plan.salary?.over, `${team.name}: « plafond » exactly when the salary line is over`);
      assert(plan.capFit.gain === null || plan.capFit.gain >= 5, `${team.name}: a move is advised for a gain worth it (${plan.capFit.gain})`);
    }
  }
  assert(advised > 0, "some Slapshot team gets cap-fit advice");
  // Its cost: the browser runs it on the main thread (once per roster and
  // lineup period). Lineup solves are machine-independent: on 2026-10-03 the
  // per-day memo and the search's bound (cap-fit.ts) took it from a median of
  // 4,764 solves / 251 ms (max 41,194 / 2,045 ms, St Louis's 35 counted) to
  // 683 / 39 ms (max 3,098 / 194 ms), the same advice on all 32 teams. The
  // wall-clock bound is loose (CI machines vary).
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1]!;
  const solves = cost.map((c) => c.solves);
  const ms = cost.map((c) => c.ms);
  console.log(`  cap fit: median ${med(solves)} solves / ${med(ms).toFixed(0)} ms, max ${Math.max(...solves)} solves / ${Math.max(...ms).toFixed(0)} ms (${cost.length} teams)`);
  assert(med(solves) <= MAX_MEDIAN_SOLVES, `cap fit median solves ${med(solves)} > ${MAX_MEDIAN_SOLVES}`);
  assert(Math.max(...solves) <= MAX_SOLVES, `cap fit max solves ${Math.max(...solves)} > ${MAX_SOLVES}`);
  assert(med(ms) <= 200, `cap fit median ${med(ms).toFixed(0)} ms > 200 ms`);
}

// ---- a league without a salary cap carries no cap-fit field.
{
  const J = (p: string) => JSON.parse(readFileSync(p, "utf8"));
  const league = J("src/data/fantrax/league.json");
  const plan = buildDailyPlan({
    league,
    state: J("public/fantrax/state.json"),
    values: J("public/fantrax/values.json"),
    schedule: J("public/fantrax/schedule-20262027.json"),
    teamId: league.teams[0].id,
    nowMs: Date.parse(J("public/fantrax/state.json").fetchedAt),
  });
  assert(!("capFit" in plan), "Captains: no capFit");
}

if (failed) {
  console.error(`test-cap-fit: ${failed} failure(s)`);
  process.exit(1);
}
console.log("test-cap-fit: ok");
