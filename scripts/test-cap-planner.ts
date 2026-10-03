/**
 * Games-cap planner (`capDayPlan`): the rules on hand-made days, then a CI
 * guard on a seeded synthetic season — a deep roster under 52 GP / 8 GS
 * weekly caps, games drawn at random — where the planner must keep beating
 * both starting everyone and the single per-period bar it replaced
 * (`capBenchPolicy`, bd259b2). The real-season numbers come from
 * scripts/backtest-mgmt.ts (off CI, NHL game lines).
 */
import { capDayPlan, benchBelow, perGameValue } from "../src/lib/fantrax/cap-planner";
import { capBenchPolicy, withCapBench } from "../src/lib/fantrax/daily-plan";
import { optimizeLineup, type LineupCandidate } from "../src/lib/fantrax/lineup";
import type { SlotCounts, SlotId } from "../src/lib/fantrax/config";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

const w = (id: string, v: number, games = 1): LineupCandidate => ({ id, eligible: ["W"], status: "ACTIVE", values: { W: v }, games });
const W2: SlotCounts = { C: 0, W: 2, F: 0, D: 0, Skt: 0, G: 0 };

// ---- the per-game rule: two 1-point wingers would use both games on day 1;
// the star who only plays day 2 needs one of them.
{
  const day1 = [w("w1", 1), w("w2", 1)];
  const day2 = [w("w1", 1), w("w2", 1), w("s", 4)];
  const plan = capDayPlan([day1, day2], W2, ["W"], { gpMax: 2, gsMax: null, gpUsed: 0, gsUsed: 0 });
  assert(plan !== null && plan.skater !== null && plan.skater > 1 && plan.goalie === null, `bench the 1-point wingers tonight (${JSON.stringify(plan)})`);
  // All in: day 1 counts 2, then the cap is reached. Benched (a bar cannot
  // split the two tied wingers): day 2 counts the star and a winger, 5.
  assert(plan !== null && near(plan.gain, 3), `gain 5 - 2 (${plan?.gain})`);
}

// ---- the crossing rule: 1 game left under a 5-game cap, a 2-game night
// then a 2-game night: tonight's 2 games cross the cap and count in full,
// so play everyone tonight (nothing to bench); tomorrow counts nothing.
{
  const night = [w("a", 3), w("b", 3)];
  const plan = capDayPlan([night, night], W2, ["W"], { gpMax: 5, gsMax: null, gpUsed: 4, gsUsed: 0 });
  assert(plan === null, `crossing tonight with both counts 6; nothing to gain by benching (${JSON.stringify(plan)})`);
  // A bigger night later: 3 games left; tonight 2 weak, tomorrow 2 stars.
  // Starting both tonight (2 < 3 left) keeps tomorrow under the cap anyway.
  const weak = [w("a", 1), w("b", 1)];
  const stars = [w("c", 5), w("d", 5)];
  const p2 = capDayPlan([weak, stars], W2, ["W"], { gpMax: 5, gsMax: null, gpUsed: 2, gsUsed: 0 });
  assert(p2 === null, `2 + 2 games with 3 left: the stars' night starts at 4 < 5 and counts (${JSON.stringify(p2)})`);
  // 2 games left: playing both weak wingers tonight reaches the cap before
  // the stars' night. One of them is enough to keep it open... but benching
  // both keeps it open too and loses 1 more: bench exactly one (bar between).
  const p3 = capDayPlan([[w("a", 1), w("b", 1.5)], stars], W2, ["W"], { gpMax: 5, gsMax: null, gpUsed: 3, gsUsed: 0 });
  assert(p3 !== null && p3.skater !== null && p3.skater > 1 && p3.skater <= 1.5, `bench only the weaker one (${JSON.stringify(p3)})`);
  const kept = optimizeLineup(benchBelow([w("a", 1), w("b", 1.5)], false, p3!.skater), W2, ["W"]);
  assert(kept.assignments.filter((a) => a.playerId).map((a) => a.playerId).join() === "b", "the 1.5 stays in");
}

// ---- a benched player leaves the lineup: bd259b2 zeroed his values only,
// so the optimizer still seated him at 0 on a free seat, where he plays and
// spends a game (-34 points a team-season in scripts/backtest-mgmt.ts).
{
  const res = optimizeLineup(withCapBench([{ ...w("a", 1), currentSlot: "W" }, w("b", 3)], { skater: 2, goalie: null }), W2, ["W"]);
  assert(res.assignments.filter((a) => a.playerId).map((a) => a.playerId).join() === "b", "the benched winger takes no free seat");
  assert(res.moves.some((m) => m.id === "a" && m.to === "RESERVE"), "and the plan moves him to Reserve");
}

// ---- probabilistic games: a goalie who starts half the time uses half a start.
{
  const g = (id: string, v: number, p: number): LineupCandidate => ({ id, eligible: ["G"], status: "ACTIVE", values: { G: v * p }, games: p });
  assert(near(perGameValue(g("x", 4, 0.5)), 4), "per-game value of a goalie = points per start");
  const locked = { ...w("l", 0.1), locked: true };
  assert(benchBelow([locked], false, 5)[0] === locked, "a locked player is never benched");
}

// ---- seeded synthetic seasons (CI guard).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SLOTS: SlotCounts = { C: 3, W: 5, F: 1, D: 3, Skt: 1, G: 2 };
const ORDER: SlotId[] = ["C", "W", "F", "D", "Skt", "G"];
interface P {
  id: string;
  pos: "C" | "W" | "D" | "G";
  mean: number;
  p: number;
  team: number;
}
function season(seed: number) {
  const r = rng(seed);
  const players: P[] = [];
  const add = (pos: P["pos"], n: number, lo: number, hi: number) => {
    for (let i = 0; i < n; i++) players.push({ id: `${pos}${i}`, pos, mean: lo + (hi - lo) * r(), p: pos === "G" ? 0.45 + 0.3 * r() : 0.85 + 0.15 * r(), team: Math.floor(r() * 32) });
  };
  add("C", 6, 2, 5);
  add("W", 9, 2, 5);
  add("D", 6, 1.8, 4.5);
  add("G", 3, 3, 5.5);
  // 20 weeks; each club plays a given day with probability 0.48.
  const plays = Array.from({ length: 140 }, () => Array.from({ length: 32 }, () => r() < 0.48));
  const outcome = Array.from({ length: 140 }, () => players.map((pl) => (r() < pl.p ? pl.mean * (0.2 + 1.6 * r()) : -1)));
  return { players, plays, outcome };
}
const ELIG: Record<P["pos"], SlotId[]> = { C: ["C", "F", "Skt"], W: ["W", "F", "Skt"], D: ["D", "Skt"], G: ["G"] };
function cands(s: ReturnType<typeof season>, day: number): LineupCandidate[] {
  return s.players
    .filter((pl) => s.plays[day]![pl.team])
    .map((pl) => {
      const values: Partial<Record<SlotId, number>> = {};
      for (const slot of ELIG[pl.pos]) values[slot] = pl.p * (slot === "Skt" ? 1.4 * pl.mean : pl.mean);
      return { id: pl.id, eligible: ELIG[pl.pos], status: "ACTIVE", values, games: pl.p };
    });
}
function run(s: ReturnType<typeof season>, policy: "all" | "bars" | "planner"): number {
  let total = 0;
  for (let wk = 0; wk < 20; wk++) {
    let gp = 0;
    let gs = 0;
    for (let d = wk * 7; d < wk * 7 + 7; d++) {
      const days = [];
      for (let x = d; x < wk * 7 + 7; x++) days.push(cands(s, x));
      const cap = { gpMax: 52, gsMax: 8, gpUsed: gp, gsUsed: gs };
      let today = days[0]!;
      if (policy === "bars") {
        const b = capBenchPolicy(days, SLOTS, ORDER, cap, { gp: true, gs: true });
        if (b) today = withCapBench(today, b);
      } else if (policy === "planner") {
        const b = capDayPlan(days, SLOTS, ORDER, cap);
        if (b) today = withCapBench(today, b);
      }
      const res = optimizeLineup(today, SLOTS, ORDER);
      let sk = 0;
      let gl = 0;
      let dGp = 0;
      let dGs = 0;
      for (const a of res.assignments) {
        if (!a.playerId) continue;
        const i = s.players.findIndex((pl) => pl.id === a.playerId);
        const pts = s.outcome[d]![i]!;
        if (pts < 0) continue;
        const v = a.slot === "Skt" ? 1.4 * pts : pts;
        if (a.slot === "G") {
          gl += v;
          dGs++;
        } else {
          sk += v;
          dGp++;
        }
      }
      if (gp < 52) total += sk;
      if (gs < 8) total += gl;
      gp += dGp;
      gs += dGs;
    }
  }
  return total;
}
{
  const t0 = Date.now();
  let all = 0;
  let bars = 0;
  let planner = 0;
  for (const seed of [11, 22, 33]) {
    const s = season(seed);
    all += run(s, "all");
    bars += run(s, "bars");
    planner += run(s, "planner");
  }
  const ms = Date.now() - t0;
  console.log(`synthetic seasons x3: start everyone ${all.toFixed(1)}, per-period bar ${bars.toFixed(1)}, planner ${planner.toFixed(1)} (${ms} ms)`);
  // Pinned on the seeded draws (deterministic): the planner must keep its lead.
  // 2026-10-02: start everyone 12991.7, bar 13456.9, planner 13848.0.
  assert(planner > all + 600, `planner beats starting everyone by > 600 (${(planner - all).toFixed(1)})`);
  assert(planner > bars + 250, `planner beats the per-period bar by > 250 (${(planner - bars).toFixed(1)})`);
  assert(bars > all, `the bar itself still beats starting everyone (${(bars - all).toFixed(1)})`);
}

if (failed) process.exit(1);
console.log("OK: games-cap planner");
