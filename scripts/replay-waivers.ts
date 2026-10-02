/**
 * Waiver replay (FX-2 / FX-3), off CI. For the Captains teams x scoring
 * periods 2, 8, 14 (by default), the top 3 waiver targets shown at the
 * period's start (delta + ros), against a day-by-day replay of the whole
 * plan to the end of the fantasy regular season with and without the swap:
 *  - capped (Fantrax's counter): each lineup period's plan is built with the
 *    games already used in its scoring period (state.caps), its lineup's
 *    points count until the period's GP (GS) cap is reached (that day in
 *    full), and only the lineup's ACTIVE games accrue;
 *  - audit: the audit's replay (caps {} on every day, plan.lineup.total).
 * Targets come from the plan as shipped (later caps) and from the cap-blind
 * rest of season (waiverRosCapBlind). Prints false losers (shown > 0,
 * replay < 0) and the error of delta + ros.
 * Run: npx tsx scripts/replay-waivers.ts [teams 0-16] [periods 2,8,14] [both|capped|audit] [out.json]
 * (16 teams x 3 periods: about 10 minutes; split the teams across processes.)
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildDailyPlan } from "../src/lib/fantrax/daily-plan";
import { CAPTAINS_DYNASTY, eligibleSlots } from "../src/lib/fantrax/config";
import { skaterSlotValue } from "../src/lib/fantrax/scoring";
import { scoringPeriodAt } from "../src/lib/fantrax/dates";
/* eslint-disable @typescript-eslint/no-explicit-any */
const J = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
const league = J("src/data/fantrax/league.json");
const values = J("public/fantrax/values.json");
const state0 = J("public/fantrax/state.json");
const schedule = J("public/fantrax/schedule-20262027.json");
const cfg = CAPTAINS_DYNASTY;
const firstPlayoff = league.playoffs?.firstPeriod ?? 99;
const lastEnd = Date.parse(league.scoringPeriods.filter((p: any) => p.number < firstPlayoff).at(-1).end);
const TOP = 3;
const teamsArg = (process.argv[2] ?? "0-16").split("-").map(Number);
const SPS = (process.argv[3] ?? "2,8,14").split(",").map(Number);
const MODE = process.argv[4] ?? "both"; // capped | audit | both
function lineupParts(plan: any) {
  let sk = 0, gl = 0, gp = 0, gs = 0;
  for (const s of plan.lineup?.slots ?? []) {
    if (!s.id || !(s.value > 0)) continue;
    const rec = values.players[s.id];
    if (s.slot === "G") { gl += s.value; gs += s.value / (rec.gE || 1); }
    else {
      const per = skaterSlotValue(rec.off ?? 0, rec.dx ?? 0, s.slot, league.sktMultiplier, { isD: eligibleSlots(rec.e, cfg).includes("D") });
      sk += s.value; gp += per > 0 ? s.value / per : 0;
    }
  }
  return { sk, gl, gp, gs };
}
function seasonTotal(teamId: string, roster: any[], fromMs: number, capped: boolean) {
  let tot = 0, spNum = -1, gp = 0, gs = 0;
  for (const rp of league.rosterPeriods.filter((p: any) => Date.parse(p.start) >= fromMs && Date.parse(p.start) <= lastEnd)) {
    const nowMs = Date.parse(rp.start) - 60_000;
    const sp: any = scoringPeriodAt(league.scoringPeriods, Date.parse(rp.start));
    if (sp.number !== spNum) { spNum = sp.number; gp = 0; gs = 0; }
    const caps = capped ? { [teamId]: { gp, gs, gpMax: sp.gpMax, gsMax: sp.gsMax } } : {};
    const state = { ...state0, rosters: { ...state0.rosters, [teamId]: roster }, fetchedAt: new Date(nowMs).toISOString(), scoringPeriod: capped ? sp.number : state0.scoringPeriod, caps, draft: null, waivers: [] };
    const plan = buildDailyPlan({ league, state, values, schedule, teamId, nowMs, config: cfg, waiverRosSampleDays: 0 });
    if (!capped) { tot += plan.lineup?.total ?? 0; continue; }
    const d = lineupParts(plan);
    if (sp.gpMax == null || gp < sp.gpMax) tot += d.sk;
    if (sp.gsMax == null || gs < sp.gsMax) tot += d.gl;
    gp += d.gp; gs += d.gs;
  }
  return tot;
}
const rows: any[] = [];
const t0 = Date.now();
for (const team of league.teams.slice(teamsArg[0], teamsArg[1])) for (const spn of SPS) {
  const sp = league.scoringPeriods.find((p: any) => p.number === spn);
  const nowMs = Date.parse(sp.start) - 3600_000;
  const st = { ...state0, fetchedAt: new Date(nowMs).toISOString(), scoringPeriod: sp.number, caps: {}, draft: null };
  const fixed = buildDailyPlan({ league, state: st, values, schedule, teamId: team.id, nowMs, config: cfg });
  const blind = buildDailyPlan({ league, state: st, values, schedule, teamId: team.id, nowMs, config: cfg, waiverRosCapBlind: true });
  const roster0 = state0.rosters[team.id];
  if (!fixed.target) continue;
  const fromMs = Date.parse(fixed.target.start);
  const cache = new Map<string, number>();
  const truth = (t: any, capped: boolean) => {
    const k = `${t.id}:${t.drop?.id ?? "-"}:${capped}`;
    if (cache.has(k)) return cache.get(k)!;
    const dr = t.drop ? roster0.find((r: any) => r.id === t.drop.id) : null;
    const r1 = dr ? roster0.filter((r: any) => r.id !== dr.id).concat([{ ...dr, id: t.id }]) : roster0.concat([{ id: t.id, status: "RESERVE" }]);
    const v = seasonTotal(team.id, r1, fromMs, capped) - base(capped);
    cache.set(k, v);
    return v;
  };
  const baseCache = new Map<boolean, number>();
  const base = (capped: boolean) => { if (!baseCache.has(capped)) baseCache.set(capped, seasonTotal(team.id, roster0, fromMs, capped)); return baseCache.get(capped)!; };
  for (const [label, plan] of [["fixed", fixed], ["blind", blind]] as const) {
    plan.waivers.targets.slice(0, TOP).forEach((t: any, i: number) => {
      const row: any = { team: team.name, sp: spn, label, rank: i + 1, id: t.id, name: values.players[t.id]?.n, drop: t.drop?.id ?? null, dropName: t.drop ? values.players[t.drop.id]?.n : null, delta: t.delta, ros: t.ros, shown: t.delta + t.ros };
      if (MODE !== "audit") row.capped = truth(t, true);
      if (MODE !== "capped") row.audit = truth(t, false);
      rows.push(row);
      console.log(`${label} ${team.name} sp${spn} #${i + 1} ${row.name} for ${row.dropName ?? "-"}: shown ${t.delta}+${t.ros}=${row.shown.toFixed(1)} capped ${row.capped?.toFixed(1)} audit ${row.audit?.toFixed(1)} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
    });
  }
}
if (process.argv[5]) writeFileSync(process.argv[5], JSON.stringify(rows));
const med = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1] ?? 0;
for (const label of ["blind", "fixed"]) {
  for (const truthKey of MODE === "both" ? ["capped", "audit"] : [MODE]) {
    const s = rows.filter((r) => r.label === label);
    const firsts = s.filter((r) => r.rank === 1);
    console.log(
      `${label === "fixed" ? "shipped" : "cap-blind ros"} vs ${truthKey} replay: ${s.length} shown, ${s.filter((r) => r[truthKey] < 0).length} false losers (${firsts.filter((r) => r[truthKey] < 0).length} of ${firsts.length} first picks), median |error| ${med(s.map((r) => Math.abs(r.shown - r[truthKey]))).toFixed(2)}`,
    );
  }
}
