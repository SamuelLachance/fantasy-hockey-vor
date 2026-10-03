/**
 * Management backtest, off CI: daily Captains lineups under the weekly games
 * caps (52 GP / 8 GS, ACTIVE seats only, the crossing day in full), replayed
 * game by game over past NHL seasons for 16 simulated rosters each
 * (`mgmt-sim.ts`: snake draft on last season, decisions on what was known
 * that morning, truth = the box score).
 *
 * Policies, same projections for all:
 *  - human:  start the best projected lineup of whoever is not known out
 *            (the optimizer itself, captain included), every day, until the
 *            caps stop counting — « start best by projection »;
 *  - engine-raw: the plan's expected values (P(play), back-to-back goalie
 *            shares), no cap policy;
 *  - bd259b2: engine + per-game bench bars (`capBenchPolicy`) when the
 *            projected games reach a cap, exactly as shipped at bd259b2
 *            (`mgmt-legacy.ts`: a benched player still took a free seat);
 *  - bars-fixed: the same bars, benched players really out of the lineup;
 *  - planner: engine + `capDayPlan` (stochastic DP over the period's days).
 * Paired per team-season differences, mean and 95% interval.
 *
 * Run: npx tsx scripts/backtest-mgmt.ts --cache=<dir> [--seasons=20212022,...] [--teams=16] [--fetch] [--out=file.json]
 */
import { writeFileSync } from "fs";
import { optimizeLineup, type LineupCandidate } from "../src/lib/fantrax/lineup";
import { capBenchPolicy, withCapBench } from "../src/lib/fantrax/daily-plan";
import { capDayPlan } from "../src/lib/fantrax/cap-planner";
import { legacyCapBenchPolicy, legacyWithCapBench } from "./mgmt-legacy";
import type { WaiverCap } from "../src/lib/fantrax/waivers";
import {
  CAPTAINS_ORDER,
  CAPTAINS_SLOTS,
  candidates,
  draftLeague,
  ensureSeason,
  Knowledge,
  loadSeason,
  meanCi,
  realize,
  ROSTER_NEEDS,
  weeks,
  type Pos,
} from "./mgmt-sim";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CACHE = arg("cache") ?? process.env.MGMT_CACHE;
if (!CACHE) {
  console.error("--cache=<dir> (NHL stats REST game lines, see mgmt-sim.ts) is required");
  process.exit(1);
}
const SEASONS = (arg("seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",");
const TEAMS = Number(arg("teams") ?? 16);
const NEEDS = arg("needs")
  ? (Object.fromEntries(arg("needs")!.split(",").map((x) => [x[0], Number(x.slice(1))])) as Record<Pos, number>)
  : ROSTER_NEEDS;
const POLICIES = (arg("policies") ?? "human,engine-raw,bd259b2,planner").split(",");

type Policy = (ctx: {
  k: Knowledge;
  roster: number[];
  d: number;
  days: number[];
  cap: WaiverCap;
}) => LineupCandidate[];

const slots = { ...CAPTAINS_SLOTS };
const order = CAPTAINS_ORDER;

const engineDays = (k: Knowledge, roster: number[], d: number, days: number[]) => days.map((x) => candidates(k, roster, d, x, "engine"));

/** The shipped binding test: expected games of each day's optimal lineup reach a cap before the last day. */
function shippedBinds(ds: LineupCandidate[][], cap: WaiverCap): { gp: boolean; gs: boolean } {
  let gp = cap.gpUsed;
  let gs = cap.gsUsed;
  ds.slice(0, -1).forEach((c) => {
    const res = optimizeLineup(c, slots, order);
    const byId = new Map(c.map((x) => [x.id, x]));
    for (const a of res.assignments) {
      if (!a.playerId || a.value <= 0) continue;
      const g = byId.get(a.playerId)!.games ?? 1;
      if (a.slot === "G") gs += g;
      else gp += g;
    }
  });
  return { gp: cap.gpMax !== null && ds.length > 0 && gp >= cap.gpMax, gs: cap.gsMax !== null && ds.length > 0 && gs >= cap.gsMax };
}

const POLICY: Record<string, Policy> = {
  human: ({ k, roster, d }) => candidates(k, roster, d, d, "human"),
  "engine-raw": ({ k, roster, d }) => candidates(k, roster, d, d, "engine"),
  bd259b2: ({ k, roster, d, days, cap }) => {
    const ds = engineDays(k, roster, d, days);
    const binds = shippedBinds(ds, cap);
    if (!binds.gp && !binds.gs) return ds[0]!;
    const policy = legacyCapBenchPolicy(ds, slots, order, cap, binds);
    return policy ? legacyWithCapBench(ds[0]!, policy) : ds[0]!;
  },
  // bd259b2's bars with the benched players really out of the lineup.
  "bars-fixed": ({ k, roster, d, days, cap }) => {
    const ds = engineDays(k, roster, d, days);
    const binds = shippedBinds(ds, cap);
    if (!binds.gp && !binds.gs) return ds[0]!;
    const policy = capBenchPolicy(ds, slots, order, cap, binds);
    return policy ? withCapBench(ds[0]!, policy) : ds[0]!;
  },
  "planner-gated": ({ k, roster, d, days, cap }) => {
    // The planner only on days the shipped binding test fires.
    const ds = engineDays(k, roster, d, days);
    const binds = shippedBinds(ds, cap);
    if (!binds.gp && !binds.gs) return ds[0]!;
    const plan = capDayPlan(ds, slots, order, cap);
    return plan ? withCapBench(ds[0]!, plan) : ds[0]!;
  },
  planner: ({ k, roster, d, days, cap }) => {
    const ds = engineDays(k, roster, d, days);
    const plan = capDayPlan(ds, slots, order, cap);
    return plan ? withCapBench(ds[0]!, plan) : ds[0]!;
  },
};

interface Row {
  season: string;
  team: number;
  totals: Record<string, number>;
  /** Points lost to the caps (games played after a cap was reached). */
  wasted: Record<string, number>;
  goalie: Record<string, number>;
}

async function main() {
  const rows: Row[] = [];
  const t0 = Date.now();
  for (const sid of SEASONS) {
    if (process.argv.includes("--fetch")) await ensureSeason(CACHE!, sid);
    const s = loadSeason(CACHE!, sid);
    const k = new Knowledge(s);
    const league = draftLeague(s, TEAMS, Number(sid.slice(0, 4)), NEEDS);
    const periods = weeks(s);
    for (let t = 0; t < league.length; t++) {
      const roster = league[t]!;
      const totals: Record<string, number> = {};
      const wasted: Record<string, number> = {};
      const goalie: Record<string, number> = {};
      for (const name of POLICIES) {
        let total = 0;
        let lost = 0;
        let gl = 0;
        for (const w of periods) {
          let gp = 0;
          let gs = 0;
          for (let d = w.from; d <= w.to; d++) {
            const days: number[] = [];
            for (let x = d; x <= w.to; x++) days.push(x);
            const cands = POLICY[name]!({ k, roster, d, days, cap: { gpMax: w.gpMax, gsMax: w.gsMax, gpUsed: gp, gsUsed: gs } });
            const res = optimizeLineup(cands, slots, order);
            const r = realize(s, res.assignments, d);
            if (gp < w.gpMax) total += r.skPts;
            else lost += r.skPts;
            if (gs < w.gsMax) {
              total += r.glPts;
              gl += r.glPts;
            }
            else lost += r.glPts;
            gp += r.gp;
            gs += r.gs;
          }
        }
        totals[name] = total;
        wasted[name] = lost;
        goalie[name] = gl;
      }
      rows.push({ season: sid, team: t, totals, wasted, goalie });
      console.log(`${sid} team ${t + 1}: ${POLICIES.map((p) => `${p} ${totals[p]!.toFixed(1)} (lost ${wasted[p]!.toFixed(0)})`).join(" | ")} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify(rows));
  console.log("\nPaired differences, points per team-season (mean [95% CI], n):");
  const pairs: Array<[string, string]> = [];
  for (const a of POLICIES) for (const b of POLICIES) if (a !== b && POLICIES.indexOf(a) > POLICIES.indexOf(b)) pairs.push([a, b]);
  for (const [a, b] of pairs) {
    const all = meanCi(rows.map((r) => r.totals[a]! - r.totals[b]!));
    const bySeason = SEASONS.map((sid) => meanCi(rows.filter((r) => r.season === sid).map((r) => r.totals[a]! - r.totals[b]!)).mean.toFixed(1));
    const wins = rows.filter((r) => r.totals[a]! > r.totals[b]! + 1e-9).length;
    const g = meanCi(rows.map((r) => r.goalie[a]! - r.goalie[b]!));
    console.log(`  ${a} - ${b}: ${all.mean.toFixed(1)} [${all.lo.toFixed(1)}, ${all.hi.toFixed(1)}] n=${all.n}, wins ${wins}/${rows.length}; by season ${bySeason.join(" / ")}; goalies ${g.mean.toFixed(1)} [${g.lo.toFixed(1)}, ${g.hi.toFixed(1)}]`);
  }
  for (const p of POLICIES) console.log(`  ${p}: mean season total ${meanCi(rows.map((r) => r.totals[p]!)).mean.toFixed(1)}, lost to caps ${meanCi(rows.map((r) => r.wasted[p]!)).mean.toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
