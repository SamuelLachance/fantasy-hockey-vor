/**
 * Waiver backtest, off CI: one Captains team manages its roster through a
 * past NHL season (the other 15 snake-drafted rosters stand still, so the
 * free-agent pool is every player nobody drafted, call-ups included), every
 * Monday before the lineup locks, up to `--claims` swaps; lineups every day
 * by the shipped cap planner; truth = the box scores (`mgmt-sim.ts`).
 *
 * Policies (same projections, same lineup engine):
 *  - none:   never touches the roster;
 *  - human:  add the free agent with the best projected points per game
 *            (not known out), drop the worst projected player of his
 *            position, when the gain passes 0.15 a game — « add the
 *            highest projected FA »;
 *  - human-sched: the streamer who reads the schedule: drop the worst
 *            projected player of a position, add the free agent with the
 *            most projected points over the period's remaining games
 *            (points a game x his club's games left), when that gains
 *            0.5 points over the period;
 *  - engine: `waiverTargets` — the lineup-aware gain of each add / drop
 *            over the period under its games caps plus the rest of the
 *            season under each later period's caps (`--ros=capped` as
 *            shipped at bd259b2, `--ros=planned` the cap-planner model);
 *            the best target (ranked by delta + ros) when it gains the
 *            league's bar this period (`--gate`, as the plan ships).
 *
 * Run: npx tsx scripts/backtest-mgmt-waivers.ts --cache=<dir> [--seasons=...] [--managed=0,5,10,15] [--claims=2] [--policies=none,human,human-sched,engine]
 *      [--ros=planned|capped] [--gate=period:x|total:x] [--period-days=N] [--return=on] [--matchup=on|ga|home] [--matchup-beta=x] [--out=rows.json]
 */
import { writeFileSync } from "fs";
import { optimizeLineup, type LineupCandidate } from "../src/lib/fantrax/lineup";
import { withCapBench } from "../src/lib/fantrax/daily-plan";
import { capDayPlan } from "../src/lib/fantrax/cap-planner";
import { CAPTAINS_DYNASTY, waiverMinDelta } from "../src/lib/fantrax/config";
import { waiverTargets, type WaiverDay } from "../src/lib/fantrax/waivers";
import { CAPTAINS_ORDER, CAPTAINS_SLOTS, candidates, draftLeague, Knowledge, loadSeason, MATCHUP, meanCi, realize, RETURN_MODEL, weeks, type Season } from "./mgmt-sim";

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const CACHE = arg("cache") ?? process.env.MGMT_CACHE;
if (!CACHE) {
  console.error("--cache=<dir> is required (see mgmt-sim.ts)");
  process.exit(1);
}
const SEASONS = (arg("seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",");
const MANAGED = (arg("managed") ?? "0,5,10,15").split(",").map(Number);
const CLAIMS = Number(arg("claims") ?? 2);
const POLICIES = (arg("policies") ?? "none,human,engine").split(",");
const ROS = (arg("ros") ?? "planned") as "capped" | "planned";
// --return=on: an absent regular's later days are worth his odds of being back (mgmt-absence.ts); off by default, as shipped.
RETURN_MODEL.on = arg("return") === "on";
// --matchup=on|ga|home: the opponent index from the points it allowed, from its goals against, or home ice only.
MATCHUP.on = !!arg("matchup") && arg("matchup") !== "off";
if (arg("matchup") === "ga" || arg("matchup") === "home") MATCHUP.source = arg("matchup") as "ga" | "home";
// The opponent index's exponent (backtest-opponent.ts fits 0.9 on the points allowed, 0.4 on goals against).
MATCHUP.beta = Number(arg("matchup-beta") ?? (MATCHUP.source === "ga" ? 0.4 : MATCHUP.beta));
const slots = { ...CAPTAINS_SLOTS };
const order = CAPTAINS_ORDER;
const MIN_DELTA = waiverMinDelta(CAPTAINS_DYNASTY, 7);
/**
 * Which targets the engine acts on: "period:x" = a gain of at least x this
 * period, ranked by delta + ros (as the plan ships, x = the league's
 * `waiverMinDelta`); "total:x" = delta + ros >= x, idle this period or not.
 * Measured (--seasons all, 16 teams): total - period +2.6 [-11.4, 16.6] on
 * Captains' weeks, -41.1 [-57.3, -24.8] on 3-day periods (--period-days=3,
 * bar 1.29): the period gate stays. A scale-free bar (delta + ros >= r x
 * the lineup's points over the same horizon, FX-5) lost too: r = 0.5 % /
 * 1 % / 2.5 % / 5 % gave -4.9 / +6.1 / -7.9 / -27.8 on Captains (26-28
 * team-seasons each) and 1 % / 2.5 % -25.9 / -52.1 on 3-day periods (16).
 *
 * Re-run 2026-10-03 at 7a790ec+ (16 teams x 5 seasons, n=80 each):
 *  - weeks: engine - human +28.5 [3.3, 53.7]; engine - bd259b2's model
 *    (--ros=capped) +61.0 [37.2, 84.8]; bd259b2 - human -32.5 [-57.8, -7.2];
 *    but engine - human-sched -29.7 [-51.8, -7.6] (human-sched - human
 *    +58.2 [37.2, 79.2]);
 *  - 3-day periods: engine - human +81.8 [57.3, 106.4] (2024-26 alone
 *    +60.6 [18.9, 102.3], n=32), engine - human-sched -111.3 [-132.7, -89.9].
 * The schedule streamer beats the engine. Ranking targets by this period's
 * gain alone with rentals kept (tried as a waiverTargets option, not
 * shipped): -23.3 [-43.8, -2.8] vs the engine on weeks, +14.6 [1.3, 27.9]
 * on 3-day periods, still -53.0 / -96.8 behind human-sched. The other 15
 * rosters stand still here (no free-agent competition), which favours a
 * churning streamer: a dropped player is always there to take back.
 */
const GATE = (arg("gate") ?? `period:${MIN_DELTA}`).split(":") as [string, string];
const GATE_KIND = GATE[0] as "period" | "total";
const GATE_VALUE = Number(GATE[1]);

type Group = "C" | "W" | "D" | "G";
interface Period {
  from: number;
  to: number;
  gpMax: number | null;
  gsMax: number | null;
}
/**
 * --period-days=N: N-day scoring periods without games caps (a Slapshot-like
 * calendar: 1-4 day matchups, no GP / GS limit); default Captains' weeks.
 */
const PERIOD_DAYS = arg("period-days") ? Number(arg("period-days")) : null;
function periodsOf(s: Season): Period[] {
  if (PERIOD_DAYS === null) return weeks(s);
  const out: Period[] = [];
  for (let from = 0; from < s.dates.length; from += PERIOD_DAYS) out.push({ from, to: Math.min(s.dates.length - 1, from + PERIOD_DAYS - 1), gpMax: null, gsMax: null });
  return out;
}

function lineupFor(k: Knowledge, roster: number[], d: number, to: number, cap: { gpMax: number | null; gsMax: number | null; gpUsed: number; gsUsed: number }) {
  const days: LineupCandidate[][] = [];
  for (let x = d; x <= to; x++) days.push(candidates(k, roster, d, x, "engine"));
  const plan = cap.gpMax === null && cap.gsMax === null ? null : capDayPlan(days, slots, order, cap);
  return optimizeLineup(plan ? withCapBench(days[0]!, plan) : days[0]!, slots, order);
}

function humanMoves(s: Season, k: Knowledge, roster: number[], taken: Set<number>, d: number): Array<{ add: number; drop: number }> {
  const fpg = (id: number) => {
    const v = k.view(id, d);
    return s.pos.get(id) === "G" ? v.off * v.p : v.off + v.dx;
  };
  const moves: Array<{ add: number; drop: number }> = [];
  const cur = [...roster];
  for (let c = 0; c < CLAIMS; c++) {
    let best: { add: number; drop: number; gain: number } | null = null;
    for (const g of ["C", "W", "D", "G"] as Group[]) {
      const mine = cur.filter((id) => s.pos.get(id) === g);
      if (!mine.length) continue;
      const worst = mine.reduce((a, b) => (fpg(a) <= fpg(b) ? a : b));
      for (const [id, pos] of s.pos) {
        if (pos !== g || taken.has(id) || cur.includes(id)) continue;
        const v = k.view(id, d);
        if (v.out || !v.team) continue;
        const gain = fpg(id) - fpg(worst);
        if (gain > 0.15 && (!best || gain > best.gain)) best = { add: id, drop: worst, gain };
      }
    }
    if (!best) break;
    moves.push({ add: best.add, drop: best.drop });
    cur.splice(cur.indexOf(best.drop), 1, best.add);
  }
  return moves;
}

function humanSchedMoves(s: Season, k: Knowledge, roster: number[], taken: Set<number>, d: number, to: number): Array<{ add: number; drop: number }> {
  const fpg = (id: number) => {
    const v = k.view(id, d);
    return s.pos.get(id) === "G" ? v.off * v.p : v.off + v.dx;
  };
  const games = (id: number) => {
    const t = k.view(id, d).team;
    let n = 0;
    if (t) for (let x = d; x <= to; x++) if (s.teamPlays.get(t)?.has(x)) n++;
    return n;
  };
  const pts = (id: number) => (k.view(id, d).out ? 0 : fpg(id) * games(id));
  const moves: Array<{ add: number; drop: number }> = [];
  const cur = [...roster];
  for (let c = 0; c < CLAIMS; c++) {
    let best: { add: number; drop: number; gain: number } | null = null;
    for (const g of ["C", "W", "D", "G"] as Group[]) {
      const mine = cur.filter((id) => s.pos.get(id) === g);
      if (!mine.length) continue;
      const worst = mine.reduce((a, b) => (fpg(a) <= fpg(b) ? a : b));
      for (const [id, pos] of s.pos) {
        if (pos !== g || taken.has(id) || cur.includes(id)) continue;
        const v = k.view(id, d);
        if (v.out || !v.team) continue;
        const gain = pts(id) - pts(worst);
        if (gain > 0.5 && (!best || gain > best.gain)) best = { add: id, drop: worst, gain };
      }
    }
    if (!best) break;
    moves.push({ add: best.add, drop: best.drop });
    cur.splice(cur.indexOf(best.drop), 1, best.add);
  }
  return moves;
}

function engineMoves(
  s: Season,
  k: Knowledge,
  roster: number[],
  taken: Set<number>,
  d: number,
  week: Period,
  later: Array<Period>,
  wIndex: number,
): Array<{ add: number; drop: number }> {
  const moves: Array<{ add: number; drop: number }> = [];
  const cur = [...roster];
  for (let c = 0; c < CLAIMS; c++) {
    const mk = (x: number, capPeriod?: number): WaiverDay => ({
      candidates: candidates(k, cur, d, x, "engine"),
      wwUsable: true,
      ...(capPeriod !== undefined ? { capPeriod } : {}),
      poolCandidate: (id) => candidates(k, [Number(id)], d, x, "engine")[0] ?? null,
    });
    const days: WaiverDay[] = [];
    for (let x = d; x <= week.to; x++) days.push(mk(x));
    const rosDays: WaiverDay[] = [];
    later.forEach((w, i) => {
      for (let x = w.from; x <= w.to; x++) rosDays.push(mk(x, wIndex + 1 + i));
    });
    // Shortlist: the best 10 free agents per position by points over the period.
    const shortlist: number[] = [];
    for (const g of ["C", "W", "D", "G"] as Group[]) {
      const pool: Array<{ id: number; v: number }> = [];
      for (const [id, pos] of s.pos) {
        if (pos !== g || taken.has(id) || cur.includes(id)) continue;
        const view = k.view(id, d);
        if (view.out || !view.team) continue;
        let v = 0;
        for (let x = d; x <= week.to; x++) {
          const cand = candidates(k, [id], d, x, "engine")[0];
          if (cand) v += Math.max(...Object.values(cand.values).map((y) => y ?? 0));
        }
        if (v > 0) pool.push({ id, v });
      }
      pool.sort((a, b) => b.v - a.v);
      shortlist.push(...pool.slice(0, 10).map((x) => x.id));
    }
    const targets = waiverTargets(
      days,
      shortlist.map((id) => ({ id: String(id), status: "FA" as const, fpg: 0 })),
      {
        slotCounts: slots,
        slotOrder: order,
        needsDrop: true,
        drops: cur.map((id) => ({ id: String(id), action: "drop" as const, fpg: 0 })),
        minDelta: GATE_KIND === "period" ? GATE_VALUE : -1e9,
        rosDays,
        cap: week.gpMax === null && week.gsMax === null ? null : { gpMax: week.gpMax, gsMax: week.gsMax, gpUsed: 0, gsUsed: 0 },
        rosCaps: PERIOD_DAYS !== null ? null : new Map(later.map((w, i) => [wIndex + 1 + i, { gpMax: w.gpMax, gsMax: w.gsMax }] as const)),
        capModel: ROS,
      },
    );
    const best = targets[0];
    if (!best || !best.drop || (GATE_KIND === "total" && best.delta + best.ros < GATE_VALUE)) break;
    moves.push({ add: Number(best.id), drop: Number(best.drop.id) });
    cur.splice(cur.indexOf(Number(best.drop.id)), 1, Number(best.id));
  }
  return moves;
}

async function main() {
  const rows: Array<{ season: string; team: number; totals: Record<string, number>; adds: Record<string, number> }> = [];
  const t0 = Date.now();
  for (const sid of SEASONS) {
    const s = loadSeason(CACHE!, sid);
    const k = new Knowledge(s);
    const league = draftLeague(s, 16, Number(sid.slice(0, 4)));
    const periods = periodsOf(s);
    for (const m of MANAGED) {
      const totals: Record<string, number> = {};
      const adds: Record<string, number> = {};
      for (const pol of POLICIES) {
        const taken = new Set(league.filter((_, i) => i !== m).flat());
        let roster = [...league[m]!];
        let total = 0;
        let n = 0;
        periods.forEach((w, wi) => {
          // Monday morning, before the lock: claims (FA: play tonight).
          if (pol !== "none" && (PERIOD_DAYS !== null || w.to - w.from >= 2)) {
            const moves =
              pol === "human"
                ? humanMoves(s, k, roster, taken, w.from)
                : pol === "human-sched"
                  ? humanSchedMoves(s, k, roster, taken, w.from, w.to)
                  : engineMoves(s, k, roster, taken, w.from, w, periods.slice(wi + 1), wi);
            for (const mv of moves) {
              roster = roster.map((id) => (id === mv.drop ? mv.add : id));
              n++;
            }
          }
          let gp = 0;
          let gs = 0;
          for (let d = w.from; d <= w.to; d++) {
            const res = lineupFor(k, roster, d, w.to, { gpMax: w.gpMax, gsMax: w.gsMax, gpUsed: gp, gsUsed: gs });
            const r = realize(s, res.assignments, d);
            if (w.gpMax === null || gp < w.gpMax) total += r.skPts;
            if (w.gsMax === null || gs < w.gsMax) total += r.glPts;
            gp += r.gp;
            gs += r.gs;
          }
        });
        totals[pol] = total;
        adds[pol] = n;
      }
      rows.push({ season: sid, team: m, totals, adds });
      console.log(`${sid} team ${m}: ${POLICIES.map((p) => `${p} ${totals[p]!.toFixed(1)} (${adds[p]} adds)`).join(" | ")} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    }
  }
  const out = arg("out");
  if (out) writeFileSync(out, JSON.stringify(rows));
  console.log(`\nPaired differences, points per team-season (mean [95% CI]), ros model ${ROS}:`);
  for (const a of POLICIES)
    for (const b of POLICIES) {
      if (POLICIES.indexOf(a) <= POLICIES.indexOf(b)) continue;
      const c = meanCi(rows.map((r) => r.totals[a]! - r.totals[b]!));
      const wins = rows.filter((r) => r.totals[a]! > r.totals[b]!).length;
      console.log(`  ${a} - ${b}: ${c.mean.toFixed(1)} [${c.lo.toFixed(1)}, ${c.hi.toFixed(1)}] n=${c.n}, wins ${wins}/${rows.length}`);
    }
  for (const p of POLICIES) console.log(`  ${p}: mean adds ${meanCi(rows.map((r) => r.adds[p]!)).mean.toFixed(1)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
