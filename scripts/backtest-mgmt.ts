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
 *  - human-cap: the same human who also minds the caps: each morning he
 *            lists every game his best projected lineup would play from
 *            today to the end of the period, keeps the most valuable until
 *            the games left under each cap (GP for skaters, expected starts
 *            for goalies; a later day's game counts `--human-cap-later`,
 *            0.8) are used, and benches tonight whoever is not among them,
 *            unless tonight crosses the cap (that day counts in full) —
 *            « bench the weakest once the games exceed the cap »;
 *  - engine-raw: the plan's expected values (P(play), back-to-back goalie
 *            shares), no cap policy;
 *  - bd259b2: engine + per-game bench bars (`capBenchPolicy`) when the
 *            projected games reach a cap, exactly as shipped at bd259b2
 *            (`mgmt-legacy.ts`: a benched player still took a free seat);
 *  - bars-fixed: the same bars, benched players really out of the lineup;
 *  - planner: engine + `capDayPlan` (stochastic DP over the period's days);
 *  - planner-matchup: the planner with tonight's opponent and home ice in
 *            the skater values (`MATCHUP`, scripts/backtest-opponent.ts).
 * Paired per team-season differences, mean and 95% interval.
 *
 * 2026-10-03, 16 teams x 2021-22..2025-26 (n=80): planner - bd259b2 +45.9
 * [37.4, 54.4]; planner - human +56.4 [46.8, 66.0]; planner - human-cap
 * +52.9 [45.0, 60.7] (74/80); human-cap - human +3.6 [-2.6, 9.7]. Lost to
 * the caps: human 86.5, human-cap 27.7, bd259b2 72.6, planner 2.1.
 *
 * Run: npx tsx scripts/backtest-mgmt.ts --cache=<dir> [--seasons=20212022,...] [--teams=16] [--fetch] [--out=file.json]
 *      [--policies=human,human-cap,engine-raw,bd259b2,planner] [--human-cap-later=0.8]
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
  MATCHUP,
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
const POLICIES = (arg("policies") ?? "human,human-cap,engine-raw,bd259b2,planner").split(",");

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

/**
 * The cap-aware human: the period's remaining lineup games by projected
 * value, the best kept until each cap's games left are used (the game that
 * crosses it counts in full, as Fantrax does); tonight's players outside
 * them sit.
 */
/**
 * The cap-aware human counts a later day's game as this much of one (some
 * will not happen: scratches, injuries, goalie rotations). Tuned in the
 * human's favour on 2021-22 + 2023-24 (6 teams each, human-cap - human):
 * 1 → -65, 0.8 → +6.1 [-22.5, 34.8], 0.7 → -0.5, 0.6 → -16.9, 0.4 → -7.8.
 */
const HUMAN_CAP_LATER = Number(arg("human-cap-later") ?? 0.8);
function humanCapLineup(k: Knowledge, roster: number[], d: number, days: number[], cap: WaiverCap): LineupCandidate[] {
  const today = candidates(k, roster, d, d, "human");
  const games: Array<{ x: number; id: string; v: number; g: number; goalie: boolean }> = [];
  for (const x of days) {
    const c = x === d ? today : candidates(k, roster, d, x, "human");
    const byId = new Map(c.map((y) => [y.id, y]));
    for (const a of optimizeLineup(c, slots, order).assignments) {
      if (!a.playerId || a.value <= 0) continue;
      const g = (a.slot === "G" ? (byId.get(a.playerId)!.games ?? 1) : 1) * (x === d ? 1 : HUMAN_CAP_LATER);
      games.push({ x, id: a.playerId, v: a.value, g, goalie: a.slot === "G" });
    }
  }
  // Under a binding cap only tonight's kept games dress (a sat player's seat
  // stays empty rather than going to a weaker reserve who would use the game).
  let out = today;
  for (const goalie of [false, true]) {
    const max = goalie ? cap.gsMax : cap.gpMax;
    if (max === null) continue;
    let left = max - (goalie ? cap.gsUsed : cap.gpUsed);
    const mine = games.filter((g) => g.goalie === goalie).sort((a, b) => b.v - a.v);
    if (mine.reduce((a, g) => a + g.g, 0) <= left) continue;
    // Tonight crosses the cap: the crossing day counts in full, everyone plays.
    if (mine.filter((g) => g.x === d).reduce((a, g) => a + g.g, 0) >= left) continue;
    const kept = new Set<string>();
    for (const g of mine) {
      if (left <= 0) break;
      left -= g.g;
      if (g.x === d) kept.add(g.id);
    }
    out = out.filter((c) => (c.eligible.includes("G") !== goalie) || kept.has(c.id));
  }
  return out;
}

const POLICY: Record<string, Policy> = {
  human: ({ k, roster, d }) => candidates(k, roster, d, d, "human"),
  "human-cap": ({ k, roster, d, days, cap }) => humanCapLineup(k, roster, d, days, cap),
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
  // The planner with tonight's opponent and home ice in the skater values (mgmt-sim MATCHUP).
  "planner-matchup": (ctx) => {
    MATCHUP.on = true;
    try {
      return POLICY.planner!(ctx);
    } finally {
      MATCHUP.on = false;
    }
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
