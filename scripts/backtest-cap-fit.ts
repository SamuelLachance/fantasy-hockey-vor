/**
 * Salary-cap fit backtest, off CI (the CI guard is test-cap-fit.ts): the 32
 * real Slapshot rosters of the committed snapshot, the plan's stash / call-up
 * advice (`capFit`: searched on CAP_FIT_SEARCH_DAYS days, re-scored on all) against
 * the human rule (`capFitByHand`: the best 23 by season points, then while
 * over the cap send down the fewest points per M$ and call up the best who
 * fits) and against the roster as it is. --fit-days=10000 searches on every
 * day (slow: the reference for what the sample gives up).
 *
 * Scored on EVERY lineup day left in the fantasy regular season: expected points of the best daily lineup
 * of the counted players, under the projections (values.json), not box
 * scores — the season has not been played. Legal = within the 105 M$ cap and
 * the 70 M$ floor, at most 23 counted, at most maxMinors in the Minors.
 *
 * Run: npx tsx scripts/backtest-cap-fit.ts [--fit-days=N] [out.json]
 */
import { readFileSync, writeFileSync } from "fs";
import { buildDailyPlan, type PlanKit } from "../src/lib/fantrax/daily-plan";
import { PLAN_KIT } from "../src/lib/fantrax/plan-kit";
import { SLAPSHOT } from "../src/lib/fantrax/config";
import { seasonFp } from "../src/lib/fantrax/draft-inputs";
import { capFitByHand, countedValue, type CapFitPlayer, type CapFitRules } from "../src/lib/fantrax/cap-fit";
import type { LineupCandidate } from "../src/lib/fantrax/lineup";
import type { SlotCounts, SlotId } from "../src/lib/fantrax/config";
/* eslint-disable @typescript-eslint/no-explicit-any */
const J = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const league = J("src/data/fantrax/slapshot/league.json");
const state = J("public/fantrax/slapshot/state.json");
const values = J("public/fantrax/slapshot/values.json");
const schedule = J("public/fantrax/slapshot/schedule-20262027.json");
const contracts = J("public/fantrax/slapshot/contracts.json");
const today = J("src/data/fantrax/slapshot/today.json");
const nowMs = Date.parse(today.generatedAt);
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
/** --fit-days=N: days the fit's search solves on (default CAP_FIT_SEARCH_DAYS). */
const FIT_DAYS = arg("fit-days") ? Number(arg("fit-days")) : undefined;
const OUT = process.argv.slice(2).find((a) => !a.startsWith("--"));

interface Captured {
  players: CapFitPlayer[];
  rules: CapFitRules;
  days: LineupCandidate[][];
  weights: number[];
  slots: SlotCounts;
  order: readonly SlotId[];
}

function meanCi(xs: number[]) {
  const n = xs.length;
  const m = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, n - 1));
  return { n, mean: m, lo: m - (1.96 * sd) / Math.sqrt(Math.max(1, n)), hi: m + (1.96 * sd) / Math.sqrt(Math.max(1, n)) };
}
const fmt = (c: ReturnType<typeof meanCi>) => `${c.mean.toFixed(1)} [${c.lo.toFixed(1)}, ${c.hi.toFixed(1)}] n=${c.n}`;

const rows: any[] = [];
for (const team of league.teams) {
  const t0 = Date.now();
  const plan = buildDailyPlan({ league, state, values, schedule, teamId: team.id, nowMs, config: SLAPSHOT, kit: PLAN_KIT, contracts, ...(FIT_DAYS ? { capFitSearchDays: FIT_DAYS } : {}) });
  const ms = Date.now() - t0;
  // Every remaining day, captured from the plan's own candidates (no search on them).
  let cap: Captured | null = null;
  const capture: PlanKit = {
    ...PLAN_KIT,
    capFit: (players, rules, days, weights, slots, order) => {
      cap = { players: [...players], rules, days: days.map((d) => [...d]), weights: [...weights], slots, order };
      return { moves: [], usedBefore: 0, usedAfter: 0, before: 0, after: 0, legal: true };
    },
  };
  buildDailyPlan({ league, state, values, schedule, teamId: team.id, nowMs, config: SLAPSHOT, kit: capture, contracts });
  if (!cap) continue;
  const c: Captured = cap;
  const hit = new Map(c.players.map((p) => [p.id, p.hit]));
  const counted0 = new Set(c.players.filter((p) => p.status !== "MINORS").map((p) => p.id));
  const engine = new Set(counted0);
  for (const m of plan.capFit?.moves ?? []) {
    if (m.to === "MINORS") engine.delete(m.id);
    else engine.add(m.id);
  }
  const human = capFitByHand(c.players, c.rules, (id) => (values.players[id] ? seasonFp(values.players[id], SLAPSHOT) : 0));
  const minorsFixed = state.rosters[team.id].filter((r: any) => r.status === "MINORS").length;
  const legal = (s: Set<string>) => {
    const used = [...s].reduce((a, id) => a + (hit.get(id) ?? 0), 0);
    const minors = minorsFixed + [...counted0].filter((id) => !s.has(id)).length - [...s].filter((id) => !counted0.has(id)).length;
    return used <= c.rules.cap + 1e-9 && used >= c.rules.floor - 1e-9 && s.size <= c.rules.spots && minors <= c.rules.maxMinors;
  };
  const val = (s: Set<string>) => countedValue(s, c.days, c.weights, c.slots, c.order);
  const moves = (s: Set<string>) => [...s].filter((id) => !counted0.has(id)).length + [...counted0].filter((id) => !s.has(id)).length;
  const row = {
    team: team.name,
    before: { v: val(counted0), legal: legal(counted0), moves: 0 },
    engine: { v: val(engine), legal: legal(engine), moves: moves(engine) },
    human: { v: val(human), legal: legal(human), moves: moves(human) },
    days: c.days.length,
    ms,
  };
  rows.push(row);
  console.log(
    `${team.name.padEnd(24)} before ${row.before.v.toFixed(0)}${row.before.legal ? "" : "*"} | engine ${row.engine.v.toFixed(0)}${row.engine.legal ? "" : "*"} (${row.engine.moves} moves) | human ${row.human.v.toFixed(0)}${row.human.legal ? "" : "*"} (${row.human.moves} moves)`,
  );
}
if (OUT) writeFileSync(OUT, JSON.stringify(rows));
console.log(`\n${rows.length} teams, ${rows[0]?.days} lineup days each (* = illegal: over the cap / under the floor / > 23 counted / too many Minors)`);
for (const k of ["before", "engine", "human"]) console.log(`  legal ${k}: ${rows.filter((r) => r[k].legal).length}/${rows.length}`);
const both = rows.filter((r) => r.engine.legal && r.human.legal);
console.log(`  engine - human (both legal): ${fmt(meanCi(both.map((r) => r.engine.v - r.human.v)))} points, engine ahead on ${both.filter((r) => r.engine.v > r.human.v + 1e-6).length}, behind on ${both.filter((r) => r.engine.v < r.human.v - 1e-6).length}`);
const asIs = rows.filter((r) => r.before.legal && r.engine.legal);
console.log(`  engine - roster as is (both legal): ${fmt(meanCi(asIs.map((r) => r.engine.v - r.before.v)))} points`);
console.log(`  plan time with the fit: median ${[...rows.map((r) => r.ms)].sort((a, b) => a - b)[rows.length >> 1]} ms, max ${Math.max(...rows.map((r) => r.ms))} ms`);
console.log(`  moves: engine ${meanCi(rows.map((r) => r.engine.moves)).mean.toFixed(1)}, human ${meanCi(rows.map((r) => r.human.moves)).mean.toFixed(1)} a team`);
