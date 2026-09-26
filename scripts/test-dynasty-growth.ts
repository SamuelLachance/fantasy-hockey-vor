/**
 * Conditional growth of young skaters (src/lib/dynasty/growth.ts) against
 * the 2008-26 backtest (scripts/fixtures/dynasty-growth-backtest.json):
 *  1a. the central path: the model's mean G_k over each historical stratum's
 *      survivors vs the stratum's mean ratio, within 2 standard errors of
 *      that mean (cluster bootstrap) for ≥ 90% of stratum × season checks
 *      and within 3 everywhere — a path 3% off everywhere fails;
 *  1b. out of sample: the growth block fitted on 2008-13 bases predicts the
 *      2014-24 strata within 10% (pooled F and D within 5%; top producers
 *      run ~8% conservative at seasons 4-5);
 *  1c. dispersion: the simulated median FP/G of representative bases and
 *      2025-26 players' nearest analogs inside the historical IQR (± its
 *      bootstrap SE);
 *  1d. zero-filled FP (the published eFP, retention included): historical
 *      base seasons through the live simulator vs their realized FP (0 when
 *      out of the NHL) — within 15% where the model is calibrated, and a
 *      bounded, documented overstatement for 21-23-year-olds (the growth
 *      path is survivors' growth; the simulator keeps too many of them);
 * plus scoring, percentile, shape, prospect arrival (historical debut
 * quartiles by slot), routing (no games threshold), the keeper-gate fixes
 * and the French growth clause.
 * Run: npx tsx scripts/test-dynasty-growth.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { makeLevel } from "../src/lib/dynasty/aging";
import { explainFr, growthClauseFr, rosterHintFr } from "../src/lib/dynasty/explain";
import { teamKeepers } from "../src/lib/dynasty/keepers";
import { makeGrowth, seasonFpgLeague, youthBase, type GrowthGroup, type GrowthModel } from "../src/lib/dynasty/growth";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { slotPrime } from "../src/lib/dynasty/prospect";
import { makeRetention } from "../src/lib/dynasty/retention";
import { realized, replacement, year0Cal } from "../src/lib/dynasty/scale";
import { routePlayer } from "../src/lib/dynasty/segment";
import { simulatePlayer, type SimContext, type SimPlayer } from "../src/lib/dynasty/simulate";
import type { DynastyInput, DynastyRecord, SeasonLine } from "../src/lib/dynasty/types";
import { calibrateK } from "../src/lib/dynasty/value";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

const params: DynastyParams = parseParams(
  JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")),
);
const level = makeLevel(params);
const growth = makeGrowth(params, level);
const ret = makeRetention(params);
const repl = replacement(params);
const ctx = (over: Partial<SimContext> = {}): SimContext => ({
  p: params,
  level,
  ret,
  repl,
  K: 0,
  N: 2000,
  keepGate: false,
  seedKey: "|growth-test",
  growth,
  ...over,
});

interface IqrSet {
  name: string;
  g: GrowthGroup;
  age: number;
  pick: number | null;
  fpg: number;
  share: number;
  iqr: Array<[number, number] | null>;
  /** Bootstrap standard errors of the quartiles. */
  se: Array<[number, number] | null>;
}
interface Stratum {
  name: string;
  idx: number[];
  n: number;
  /** Per k = 1..horizon: survivors, their mean ratio and its cluster-bootstrap SE. */
  k: Array<{ n: number; mean: number; se: number }>;
}
/**
 * [D ? 1 : 0, base age, pick, base FP/G, base season, ratio_1 … ratio_6 (null = not a survivor),
 *  base GP share, base FP (82 games), fp_1 … fp_6 (82-game basis, 0 when out, null past 2025-26)].
 */
type Row = [number, number, number | null, number, number, ...Array<number | null>];
const R_SHARE = 11;
const R_FP = 13;
const fixtures = JSON.parse(
  readFileSync(join(process.cwd(), "scripts", "fixtures", "dynasty-growth-backtest.json"), "utf8"),
) as {
  horizon: number;
  rows: Row[];
  strata: Stratum[];
  iqr: { strata: IqrSet[]; analogs: IqrSet[] };
  oos: { params: DynastyParams["growth"]; strata: Stratum[] };
  debuts: Array<{ g: GrowthGroup; picks: [number, number]; n: number; age: number; q: [number, number, number] }>;
};
const H = fixtures.horizon;
const rowG = (r: Row): GrowthGroup => (r[0] ? "D" : "F");
/** Mean model G_k over a stratum's survivors at k (the backtest's target: survivors' growth). */
function modelMean(gm: GrowthModel, st: Stratum, k: number): number {
  let s = 0;
  let n = 0;
  for (const i of st.idx) {
    const r = fixtures.rows[i]!;
    if (r[4 + k] == null) continue;
    s += gm.path(rowG(r), r[1], r[2], r[3]).m[k - 1]!;
    n++;
  }
  return s / n;
}

// ---- 1a. the central path in sample: mean G_k vs the stratum's historical mean (± 2 SE)
let central = 0;
let central2 = 0;
{
  for (const st of fixtures.strata) {
    for (let k = 1; k <= H; k++) {
      const h = st.k[k - 1]!;
      if (h.n < 15) continue;
      const m = modelMean(growth, st, k);
      const z = (m - h.mean) / h.se;
      central++;
      if (Math.abs(z) <= 2) central2++;
      assert(Math.abs(z) <= 3, `${st.name}: mean G_${k} ${m.toFixed(3)} vs history ${h.mean} ± ${h.se} (z ${z.toFixed(1)}, |z| ≤ 3)`);
    }
  }
  assert(central2 >= 0.9 * central, `${central2}/${central} central-path checks within 2 SE of the historical mean (≥ 90%)`);
}

// ---- 1b. out of sample: the growth block fitted on 2008-13 bases vs the 2014-24 strata
let oosWorst = 0;
{
  const oosParams: DynastyParams = { ...params, growth: { ...params.growth, ...fixtures.oos.params, minBaseGp: params.growth.minBaseGp, arrival: params.growth.arrival } };
  const gOos = makeGrowth(oosParams, level);
  for (const st of fixtures.oos.strata) {
    for (let k = 1; k <= H; k++) {
      const h = st.k[k - 1]!;
      if (h.n < 15) continue;
      const ratio = modelMean(gOos, st, k) / h.mean;
      const tol = st.name.startsWith("all ") ? 0.05 : 0.1;
      oosWorst = Math.max(oosWorst, Math.abs(ratio - 1));
      assert(Math.abs(ratio - 1) <= tol, `out of sample ${st.name} k=${k}: predicted / actual ${ratio.toFixed(3)} (±${tol})`);
    }
  }
}

// ---- 1c. dispersion: the simulated median FP/G ratio inside the historical IQR (± its SE)
let checks = 0;
let strict = 0;
{
  const med = (a: number[]) => {
    const s = [...a].sort((x, y) => x - y);
    return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
  };
  for (const f of [...fixtures.iqr.strata, ...fixtures.iqr.analogs]) {
    const path = growth.path(f.g, f.age, f.pick, f.fpg);
    // an 84-game season: 20 GP of 82 is 20.5 games
    const survGames = (20 * params.games.seasonGames) / 82;
    const pl: SimPlayer = {
      id: `fx-${f.name}`,
      g: f.g,
      age0: f.age + 1,
      birthDate: null,
      gp0: 300,
      eligNow: false,
      path: "nhl",
      theta0: f.fpg * path.m[0]!,
      share0: f.share,
      sigma0: path.sigma0,
      elite: false,
      gRel: path.m.map((m) => m / path.m[0]!),
      spYoung: path.persistent,
    };
    const res = simulatePlayer(pl, ctx({ recordGames: true }));
    for (let k = 1; k <= H; k++) {
      const iqr = f.iqr[k - 1];
      const se = f.se[k - 1];
      if (!iqr || !se) continue;
      const ratios: number[] = [];
      for (let n = 0; n < res.N; n++) {
        const games = res.gamesPath![k - 1]![n]!;
        if (games >= survGames) ratios.push(res.fp[k - 1]![n]! / games / f.fpg);
      }
      const md = med(ratios);
      checks++;
      if (md >= iqr[0] && md <= iqr[1]) strict++;
      assert(md >= iqr[0] - se[0] && md <= iqr[1] + se[1], `${f.name}: simulated median FP/G ratio at k=${k} ${md.toFixed(3)} inside [${iqr[0]}, ${iqr[1]}] ± se`);
    }
  }
  assert(strict >= 0.85 * checks, `${strict}/${checks} simulated medians inside the raw IQR (≥ 85%)`);
}

// ---- 1d. zero-filled FP: historical bases through the live simulator (retention included)
const volCells: string[] = [];
{
  const N = 120;
  const S82 = 82 / params.games.seasonGames;
  const strata: Array<[string, (r: Row) => boolean, number, number]> = [
    // name, filter, allowed ratio range (model / history) at k = 1..5
    ["F 18-20", (r) => r[0] === 0 && r[1] < 21, 0.85, 1.15],
    ["D 18-20", (r) => r[0] === 1 && r[1] < 21, 0.85, 1.15],
    ["F 21-23 p90+", (r) => r[0] === 0 && r[1] >= 21 && growth.pct("F", r[1], r[3]) >= 0.9, 0.85, 1.15],
    ["F 21-23 p50-90", (r) => r[0] === 0 && r[1] >= 21 && growth.pct("F", r[1], r[3]) >= 0.5 && growth.pct("F", r[1], r[3]) < 0.9, 0.85, 1.2],
    ["D 21-23 p50+", (r) => r[0] === 1 && r[1] >= 21 && growth.pct("D", r[1], r[3]) >= 0.5, 0.85, 1.2],
    // known: survivors' growth applied to every path, too many kept playing (value mostly below replacement)
    ["F 21-23 below p50", (r) => r[0] === 0 && r[1] >= 21 && growth.pct("F", r[1], r[3]) < 0.5, 0.9, 1.65],
    ["D 21-23 below p50", (r) => r[0] === 1 && r[1] >= 21 && growth.pct("D", r[1], r[3]) < 0.5, 0.9, 1.65],
  ];
  const hist = strata.map(() => [0, 0, 0, 0, 0]);
  const model = strata.map(() => [0, 0, 0, 0, 0]);
  fixtures.rows.forEach((r, i) => {
    const which = strata.map(([, f]) => f(r));
    if (!which.some(Boolean)) return;
    const g = rowG(r);
    const path = growth.path(g, r[1], r[2], r[3]);
    const res = simulatePlayer(
      {
        id: `vol${i}`,
        g,
        age0: r[1] + 1,
        birthDate: null,
        gp0: 300,
        eligNow: false,
        path: "nhl",
        theta0: r[3] * path.m[0]!,
        share0: r[R_SHARE] as number,
        sigma0: path.sigma0,
        elite: false,
        gRel: path.m.map((m) => m / path.m[0]!),
        spYoung: path.persistent,
      },
      ctx({ N }),
    );
    for (let k = 1; k <= H; k++) {
      const h = r[R_FP + k] as number | null;
      if (h == null) continue;
      const m = (res.fp[k - 1]!.reduce((a, x) => a + x, 0) / N) * S82;
      which.forEach((w, j) => {
        if (!w) return;
        hist[j]![k - 1] += h;
        model[j]![k - 1] += m;
      });
    }
  });
  strata.forEach(([name, , lo, hi], j) => {
    const ratios = hist[j]!.map((h, k) => model[j]![k]! / h);
    volCells.push(`${name} ${ratios.map((x) => x.toFixed(2)).join("/")}`);
    ratios.forEach((x, k) => assert(x >= lo && x <= hi, `${name}: zero-filled FP at k=${k + 1} model / history ${x.toFixed(2)} in [${lo}, ${hi}]`));
  });
}

// ---- 2. scoring and production percentile (the backtest's own numbers)
{
  const demidov: SeasonLine = { season: 2025, gp: 82, toi: 930, goals: 19, assists: 43, shots: 127, hits: 28, blocks: 26, takeaways: 22 };
  const s = seasonFpgLeague(params, "F", [demidov])!;
  assert(near(s.fpg, 2.518, 0.01), `Demidov 2025-26 league-scoring FP/G ≈ 2.518 (got ${s.fpg.toFixed(3)})`);
  assert(near(growth.pct("F", 19.809, 2.518), 0.657, 0.04), `Demidov's production percentile at 19 ≈ p66 (got ${growth.pct("F", 19.809, 2.518).toFixed(3)})`);
  const split = seasonFpgLeague(params, "F", [
    { ...demidov, gp: 40, goals: 9, assists: 20, shots: 60, hits: 14 },
    { ...demidov, gp: 42, goals: 10, assists: 23, shots: 67, hits: 14 },
  ])!;
  assert(split.gp === 82 && near(split.fpg, s.fpg, 0.02), "two teams in one season add up");
  const schaefer = seasonFpgLeague(params, "D", [{ season: 2025, gp: 82, toi: 1481, goals: 23, assists: 36, shots: 222, hits: 40, blocks: 111, takeaways: 38 }])!;
  assert(near(schaefer.fpg, 3.62, 0.02), `Schaefer (D) ≈ 3.62 with blocks, takeaways and team shutouts (got ${schaefer.fpg.toFixed(3)})`);
  assert(growth.pct("D", 18.1, 3.62) > 0.97, "Schaefer is p97+ among 18-19-year-old D");
  const w = youthBase(params, "F", 2.36, [demidov]);
  assert(near(w.w, 82 / (82 + params.growth.blendK), 1e-12) && w.base > 2.36 && w.base < 2.518, `base blends the season and the projection (w ${w.w.toFixed(2)}, base ${w.base.toFixed(3)})`);
  assert(youthBase(params, "F", 2.36, []).base === 2.36, "no base season: the projection alone");
}

// ---- 3. shape: age, production, pedigree
{
  const g = (age: number, pick: number | null, fpg: number) => growth.path("F", age, pick, fpg).m;
  const mid19 = g(19.5, 8, 2.2);
  assert(mid19.every((m, i) => i === 0 || m >= mid19[i - 1]! - 0.03), `a median 19-year-old keeps growing (${mid19.map((x) => x.toFixed(2)).join(", ")})`);
  assert(mid19[0]! > 1.05 && mid19[2]! > 1.15, "… by more than 5% at once and 15% in three seasons");
  assert(g(19.5, 8, 1.6)[0]! > g(19.5, 8, 2.2)[0]! && g(19.5, 8, 2.2)[0]! > g(19.5, 8, 3.5)[0]!, "regression to the mean: lower producers grow more");
  const elite = g(19.3, 1, 5.0);
  assert(elite[0]! > 0.97 && elite[0]! < 1.06 && elite[2]! < 1.12, `an elite 19-year-old grows little (${elite.map((x) => x.toFixed(2)).join(", ")})`);
  assert(g(19.5, 1, 2.2)[3]! > g(19.5, 60, 2.2)[3]!, "a first overall pick outgrows a 60th at equal production");
  assert(g(19.5, 60, 2.2)[3]! > g(19.5, null, 2.2)[3]!, "… and an undrafted player grows least");
  assert(g(22.5, 10, 2.6)[2]! < g(19.5, 10, 2.6)[2]!, "less growth from 22 than from 19");
  const elite22 = g(22.5, 9, 4.0);
  assert(elite22[4]! < 1, `an elite 22-year-old regresses (${elite22.map((x) => x.toFixed(2)).join(", ")})`);
  const d = growth.path("D", 19.5, 5, 2.4);
  assert(d.m[0]! > 1 && d.sigma0 > 0 && d.persistent > 0, "D growth and shocks defined");
  const low = growth.path("F", 20, 30, 1.5);
  const top = growth.path("F", 20, 3, 4.5);
  assert(low.sigma0 > top.sigma0, `wider year-0 band for a low producer (${low.sigma0.toFixed(3)} vs ${top.sigma0.toFixed(3)})`);
  assert(low.sigma0 > params.sigma.sigma0.gp40, "the growth uncertainty widens a young regular's year-0 band beyond the old 0.14");
}

// ---- 4. prospect arrival: centred so the mean path meets the prime, spread like historical debuts
{
  // E[θ_arr · G_k*(θ_arr)] = prime · c̃(a + k*) / c̃(25) (fine grid over z)
  for (const [g, age, pick, prime] of [
    ["F", 19.2, 5, 4.2],
    ["F", 20.5, 20, 3.0],
    ["D", 19.6, 4, 2.8],
    ["D", 22.4, 60, 2.2],
  ] as const) {
    const c = growth.arrivalCentre(g, age, pick, prime);
    const k = Math.min(params.growth.horizon, Math.max(1, Math.round(25 - age)));
    const target = (prime * level(g, age + k)) / level(g, 25);
    let e = 0;
    let w = 0;
    for (let z = -5; z <= 5; z += 0.01) {
      const d = Math.exp((-z * z) / 2);
      const a = growth.arrival(g, age, pick, prime, z);
      e += d * a.theta * a.path.m[k - 1]!;
      w += d;
    }
    assert(near(e / w, target, 0.01 * target), `${g} arrival at ${age} (#${pick}, prime ${prime}): E[θ·G_${k}] ${(e / w).toFixed(3)} ≈ ${target.toFixed(3)} (centre ${c.theta.toFixed(2)})`);
  }
  // the arrival level rises with the prime draw but its spread is the debut spread, not amplified
  const lo = growth.arrival("D", 19.6, 4, 2.8, -1).theta;
  const hi = growth.arrival("D", 19.6, 4, 2.8, 1).theta;
  assert(hi > lo && Math.log(hi / lo) / 2 <= params.growth.arrival.sd.D + 1e-9, `D arrival ±1 sd: ${lo.toFixed(2)} … ${hi.toFixed(2)} (log half-range ≤ ${params.growth.arrival.sd.D})`);
  // in the simulator: first-season FP/G quartiles of slot-average prospects vs historical debuts at 18-19
  const q = (a: number[], f: number) => {
    const s = [...a].sort((x, y) => x - y);
    const i = (s.length - 1) * f;
    const l = Math.floor(i);
    return s[l]! + (s[Math.ceil(i)]! - s[l]!) * (i - l);
  };
  for (const d of fixtures.debuts) {
    const pick = Math.sqrt(d.picks[0] * d.picks[1]);
    const pros: SimPlayer = {
      id: `debut-${d.g}${d.picks.join("-")}`,
      g: d.g,
      age0: d.age,
      birthDate: null,
      gp0: 0,
      eligNow: true,
      path: "prospect",
      pick: Math.round(pick),
      pm: { pMake: 1, pi: slotPrime(params, d.g, pick), eta: 2026 },
    };
    const res = simulatePlayer(pros, ctx({ N: 3000, recordGames: true }));
    const first: number[] = [];
    for (let n = 0; n < res.N; n++) {
      for (let t = 0; t < res.T; t++) {
        const gm = res.gamesPath![t]![n]!;
        if (gm > 0) {
          if (gm >= 25) first.push(res.fp[t]![n]! / gm);
          break;
        }
      }
    }
    const m = [q(first, 0.25), q(first, 0.5), q(first, 0.75)];
    const name = `${d.g} picks ${d.picks.join("-")}`;
    for (let i = 0; i < 3; i++) {
      assert(Math.abs(m[i]! / d.q[i]! - 1) <= 0.2, `${name}: first-season FP/G ${["p25", "p50", "p75"][i]} ${m[i]!.toFixed(2)} vs historical debuts ${d.q[i]} (±20%)`);
    }
    const spread = Math.log(m[2]! / m[0]!);
    const hist = Math.log(d.q[2] / d.q[0]);
    assert(spread <= 1.35 * hist, `${name}: first-season spread ln(p75/p25) ${spread.toFixed(2)} not amplified beyond history ${hist.toFixed(2)} × 1.35`);
  }
  // an elite prospect produces more early with the conditional path than with the curve
  const elite: SimPlayer = {
    id: "arr",
    g: "F",
    age0: 18.8,
    birthDate: "2007-12-01",
    gp0: 0,
    eligNow: true,
    path: "prospect",
    pick: 1,
    pm: { pMake: 1, pi: { mu: 4.2, sd: 0 }, eta: 2026 },
  };
  const withG = simulatePlayer(elite, ctx({ N: 400 }));
  const noG = simulatePlayer(elite, ctx({ N: 400, growth: null }));
  const mean = (a: Float64Array) => a.reduce((s, x) => s + x, 0) / a.length;
  assert(mean(withG.fp[1]!) > mean(noG.fp[1]!), "an elite prospect produces more early with the conditional path than with the curve");
}

// ---- 5. routing: base season vs rookie projection, veterans untouched
{
  const line = (gp: number, goals: number, assists: number, shots: number): SeasonLine => ({ season: 2025, gp, toi: 1000, goals, assists, shots, hits: 30, blocks: 20, takeaways: 20 });
  const inp = (over: Partial<DynastyInput>): DynastyInput => ({
    id: "y",
    n: "Young",
    e: "C,F,Skt",
    team: "MTL",
    birthDate: "2005-12-15",
    careerGp: 2,
    eligNow: false,
    rostered: true,
    proj: { src: "proj", gp: 78, off: 3.25, dx: 0, method: "ml" },
    draft: { year: 2024, pick: 5 },
    draftSource: "profile",
    history: [line(82, 19, 43, 127)],
    ...over,
  });
  const r = routePlayer(params, level, inp({}));
  assert(r.growth?.src === "season", "82 GP in 2025-26 → the season is his base");
  assert(near(r.sim!.theta0!, r.growth!.base * r.growth!.path.m[0]!, 1e-9), "year 0 = base × G_1");
  assert(r.sim!.gRel!.length === params.growth.horizon && r.sim!.gRel![0] === 1, "the growth path relative to year 0");
  assert(r.traj.shift === 0 && r.sim!.trajShift === 0, "no trajectory shift inside the growth model");
  const rookie = routePlayer(params, level, inp({ id: "rk", careerGp: 0, history: [line(9, 4, 5, 20)] }));
  assert(rookie.growth?.src === "projection" && near(rookie.growth.w, 9 / (9 + params.growth.blendK), 1e-12), "9 GP → the base leans on the projection (w = 9 / 45)");
  assert(near(rookie.sim!.theta0!, rookie.growth!.base * rookie.growth!.path.m[0]!, 1e-9) && rookie.growth!.baseAge === rookie.age0 - 1, "a rookie: the same rule, year 0 = base × G_1 from the 2025-26 base age");
  // no games cliff: 29 vs 30 GP in 2025-26 at the same FP/G moves year 0 by ~1%, not 10-20%
  const at = (gp: number) => routePlayer(params, level, inp({ id: `c${gp}`, careerGp: 0, history: [{ ...line(gp, 0, 0, 0), goals: Math.round(gp * 0.25), assists: Math.round(gp * 0.4), shots: Math.round(gp * 1.9) }] })).sim!.theta0!;
  assert(Math.abs(at(30) / at(29) - 1) < 0.03, `29 → 30 GP: year 0 ${at(29).toFixed(3)} → ${at(30).toFixed(3)} (no switch)`);
  // no 2025-26 games: the projection is the base (read as the 2025-26 level)
  const P = realized(params, "F", 3.25);
  const noGames = routePlayer(params, level, inp({ id: "ng", careerGp: 0, history: [] }));
  assert(noGames.growth!.w === 0 && near(noGames.sim!.theta0!, P * noGames.growth!.path.m[0]!, 1e-9), "no 2025-26 games: the projection is the base");
  assert(noGames.growth!.baseAge < params.growth.maxBaseAge, "the path starts inside the fitted base ages");
  // the year-0 band: the projection's error for its share of the base
  assert(noGames.sim!.sigma0 === params.sigma.sigma0.low, `no base-season games: year-0 sd = the projection's (${noGames.sim!.sigma0})`);
  void year0Cal;
  const vet = routePlayer(params, level, inp({ id: "v", birthDate: "2000-01-01", careerGp: 400, history: [line(82, 25, 35, 200)] }));
  assert(vet.growth === null && vet.sim!.gRel == null, "a 26-year-old keeps the validated aging curve");
  const d = routePlayer(params, level, inp({ id: "d", e: "D,Skt", proj: { src: "proj", gp: 78, off: 2.4, dx: 0.6, method: "ml" } }));
  assert(d.g === "D" && d.growth?.src === "season", "young D in the growth model too");
  const g = routePlayer(params, level, inp({ id: "g", e: "G", proj: { src: "proj", gp: 50, gE: 4.1, method: "ml" } }));
  assert(g.growth === null, "goalies are not in the skater growth model");
}

// ---- 6. keeper fixes: the gate in keep-index units, goalies without a share floor
{
  const league: SimPlayer[] = Array.from({ length: 260 }, (_, i) => ({
    id: `k${i}`,
    g: i % 9 === 0 ? "G" : i % 4 === 0 ? "D" : "F",
    age0: 24 + (i % 12),
    birthDate: null,
    gp0: 400,
    eligNow: false,
    path: "nhl",
    theta0: i % 9 === 0 ? 3.7 + (i % 7) * 0.1 : 2.4 + (i % 23) * 0.09,
    share0: i % 9 === 0 ? 0.3 + (i % 5) * 0.12 : 0.85,
    sigma0: 0.1,
    elite: false,
  }));
  const k = calibrateK(params, league, { p: params, level, ret, repl, growth });
  assert(!k.fallback && k.gate > 0 && k.gate < k.value, `keep-index gate ${k.gate.toFixed(1)} below the V_1 slot cost ${k.value.toFixed(1)} (same marginal keeper, 4-season look-ahead with a games haircut)`);
  assert(k.gateBand[0] <= k.gate && k.gate <= k.gateBand[1], "gate inside its P10–P90 across simulated leagues");
  // a known backup is valued as a backup at the cutdown (no 50% share floor)
  const backup: SimPlayer = { id: "bk", g: "G", age0: 30, birthDate: null, gp0: 300, eligNow: false, path: "nhl", theta0: 4.3, share0: 0.2, sigma0: 0.05 };
  const kept = (floor: number) => {
    const p2: DynastyParams = { ...params, K: { ...params.K, goalieShareFloor: floor } };
    return simulatePlayer(backup, { ...ctx({ N: 600, keepGate: true, K: 40 }), p: p2 }).keptAt[1]!;
  };
  assert(kept(0) < kept(params.K.shareFloor), `a backup is kept less often without the share floor (${kept(0).toFixed(2)} vs ${kept(params.K.shareFloor).toFixed(2)})`);
}

// ---- 6a. the keep index weights later seasons by the odds he is still playing (retirement risk)
{
  const vet: SimPlayer = { id: "vet40", g: "F", age0: 40, birthDate: null, gp0: 1500, eligNow: false, path: "nhl", theta0: 3.4, share0: 0.85, sigma0: 0.1, elite: true };
  // no retirement at 30+ (the only ages where absence retires him)
  const noRetire = { ...ret, pAbsentIfNotRegular: (g: "F" | "D", age: number) => (age >= params.games.retireIfOutAge ? 0 : ret.pAbsentIfNotRegular(g, age)) };
  const a = simulatePlayer(vet, ctx({ N: 400, recordKi: true }));
  const b = simulatePlayer(vet, { ...ctx({ N: 400, recordKi: true }), ret: noRetire });
  let sa = 0;
  let sb = 0;
  for (let n = 0; n < 400; n++) {
    const x = a.ki1![n]!;
    const y = b.ki1![n]!;
    if (x > 0 && y > 0) {
      sa += x;
      sb += y;
    }
  }
  assert(sa < 0.95 * sb, `a 41-year-old's keep index counts his retirement risk (${(sa / sb).toFixed(2)} of the no-retirement index)`);
  // (one RNG stream runs through all paths, so the two runs match path by path only until a
  // retirement draw differs: compare averages, and a player too young to retire gets no discount)
  const young: SimPlayer = { ...vet, id: "vet24", age0: 24, elite: false };
  const c = simulatePlayer(young, ctx({ N: 50, recordKi: true }));
  assert(c.ki1!.every((x) => x > 0), "a 25-year-old regular is live at every 2027 cutdown");
}

// ---- 6b. team-conditional keeper odds: each team keeps its 10 best keep indices per path
{
  const N = 200;
  const ki = new Map<string, Float64Array>();
  const flat = (v: number, eligShare = 0) => Float64Array.from({ length: N }, (_, n) => (n < eligShare * N ? Number.NaN : v));
  const roster: string[] = [];
  for (let i = 0; i < 12; i++) {
    ki.set(`p${i}`, flat(100 - 5 * i));
    roster.push(`p${i}`);
  }
  ki.set("young", flat(200, 0.5)); // minors-eligible on half the paths
  roster.push("young");
  ki.set("fa", flat(72)); // unrostered: the rest of the draft brings him to T
  ki.set("fa2", flat(300)); // taken by the other team's pick first
  const res = teamKeepers(
    { rosters: { T: roster, U: ["u1"] }, remainingPicks: ["U", "T"], pool: [{ id: "fa", adp: 20 }, { id: "fa2", adp: 3 }] },
    ki,
    params.K.teamSlots,
  );
  const o = (id: string) => res.odds.get(id)!;
  assert(o("p0").pKept === 1 && o("p7").pKept === 1, "a team's top candidates are kept on every path");
  assert(near(o("p8").pKept!, 0.5, 1e-9), `the 10th slot goes to p8 only when the youngster is still minors-eligible (${o("p8").pKept})`);
  assert(o("p9").pKept === 0 && o("p11").pKept === 0, "candidates 11+ are released");
  assert(o("young").pKept === 1 && near(o("young").keptShare, 0.5, 1e-9), "P(kept) is conditional on being gated");
  const t = res.teams.get("T")!;
  assert(t.draftedIds.join() === "fa" && near(t.roster + t.drafted, 10, 1e-9), `the team's 10 slots add up (${t.roster} + ${t.drafted})`);
  assert(!res.odds.has("fa"), "draft-fill players are competitors, not reported");
  // the French sentence and hint use the team's slots when known
  const rec = (team: boolean): DynastyRecord =>
    ({
      n: "X",
      g: "F",
      age: 24,
      path: "nhl",
      seg: "young_nhl",
      phase: "prime",
      effAge: 24,
      traj: 0,
      gp: 150,
      dv: { winNow: 40, balanced: 60, longTerm: 70 },
      rank: { winNow: 1, balanced: 1, longTerm: 1 },
      band: { balanced: [0, 50, 120], longTerm: [0, 60, 150] },
      eG: [40, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0],
      p50G: new Array(12).fill(0),
      eFP: new Array(12).fill(0),
      pNhl: 1,
      eta: null,
      elig: { now: false, next: 0, freeThrough: null, binding: null, uncertain: false },
      keeper: { status: "bubble", pKept27: 0.45, ...(team ? { team: { status: "bubble" as const, pKept27: 0.62, rank: 10 } } : {}) },
      market: { w: 0 },
    }) as DynastyRecord;
  assert(explainFr(rec(true)).includes("10 protégés de son équipe"), `team view in the sentence: ${explainFr(rec(true))}`);
  assert(explainFr(rec(false)).includes("160 protégés"), "league line without a team");
  assert(rosterHintFr(rec(true)).includes("10e candidat"), `hint quotes the team rank: ${rosterHintFr(rec(true))}`);
}

// ---- 7. the French growth clause
{
  const rec = (over: Partial<DynastyRecord>): Pick<DynastyRecord, "growth"> => ({ ...over });
  const s = growthClauseFr(rec({ growth: { src: "season", base: 2.47, baseAge: 19.8, pct: 0.62, pick: 5, m: [1.1, 1.19, 1.2, 1.27, 1.28, 1.3] } }));
  assert(s === "progression attendue d’un choix du top 5 productif à 19 ans (+20 % d’ici 2028-29)", `growth clause: ${s}`);
  const e = growthClauseFr(rec({ growth: { src: "season", base: 5.0, baseAge: 19.3, pct: 0.995, pick: 1, m: [1.02, 1.07, 1.04, 1.08, 1.08, 1.09] } }));
  assert(e === "peu de progression attendue d’un 1er choix au total déjà élite à 19 ans (+4 % d’ici 2028-29)", `elite clause: ${e}`);
  const r = growthClauseFr(rec({ growth: { src: "season", base: 4.0, baseAge: 22.5, pct: 0.95, pick: 9, m: [0.97, 0.96, 0.94, 0.93, 0.92, 0.9] } }));
  assert(r!.startsWith("recul attendu d’un choix du top 10 parmi les meilleurs de son âge à 22 ans (−6"), `regression clause: ${r}`);
  const rk = growthClauseFr(rec({ growth: { src: "projection", base: 3.4, baseAge: 18.9, pct: 0.9, pick: 6, m: [1.02, 1.08, 1.07, 1.1, 1.09, 1.08] } }));
  assert(rk!.includes("projeté") && rk!.includes("d’ici 2028-29"), `rookie clause counts from the 2025-26 base like everyone: ${rk}`);
  assert(growthClauseFr(rec({})) === null, "no growth record → no clause");
}

if (failed > 0) {
  console.error(`test-dynasty-growth: ${failed} failure(s)`);
  process.exit(1);
}
console.log(
  `OK: dynasty growth (central path ${central2}/${central} within 2 SE of ${fixtures.strata.length} historical strata' means; out of sample worst ${(oosWorst * 100).toFixed(1)}%; dispersion ${strict}/${checks} simulated medians inside the raw IQR; zero-filled FP model/history k1-5 ${volCells.join(", ")}; scoring, shape, arrival vs debuts, routing, keeper gate, French clause)`,
);
