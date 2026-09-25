/**
 * Goalie roles in the dynasty simulator against history
 * (scripts/fixtures/dynasty-goalie-roles.json, NHL API 1997-2026):
 *  1. one season ahead: P(starter next), P(at least a tandem next) and the
 *     expected start share next season by age band × tier reproduce
 *     aging.json goalies.workloadTable;
 *  2. end to end: the historical starters / tandems, run through the live
 *     simulator from their year-1 season, lose FP over the next seasons as
 *     they did (goalies.horizon);
 *  3. the role logistics take the raw games-started share (the unit they
 *     were fitted in; the prototype's share / 0.6 kept tandems starting).
 * Run: npx tsx scripts/test-dynasty-goalies.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { makeLevel } from "../src/lib/dynasty/aging";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { makeRetention } from "../src/lib/dynasty/retention";
import { replacement } from "../src/lib/dynasty/scale";
import { simulatePlayer, type SimContext, type SimPlayer } from "../src/lib/dynasty/simulate";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const params: DynastyParams = parseParams(
  JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")),
);
const level = makeLevel(params);
const ret = makeRetention(params);
const repl = replacement(params);
const SG = params.games.seasonGames;
const gg = params.games.goalie;
const ctx = (N: number, seedKey: string): SimContext => ({
  p: params,
  level,
  ret,
  repl,
  K: 0,
  N,
  keepGate: false,
  seedKey,
  fixedYear0: true,
  recordGames: true,
});
const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts", "fixtures", "dynasty-goalie-roles.json"), "utf8")) as {
  workload: Record<string, { n: number; pStarterNext: number; pAtLeastTandemNext: number; expGsShareNext: number }>;
  horizon: Array<{ a1: number; gs1: number; fpg1: number; fp: number[] }>;
};
const goalie = (id: string, age0: number, share: number, theta0: number): SimPlayer => ({
  id,
  g: "G",
  age0,
  birthDate: null,
  gp0: 300,
  eligNow: false,
  path: "nhl",
  theta0,
  // year-0 start share of the season (fixed in test mode)
  share0: Math.min(gg.maxShare, share),
  sigma0: 0.1,
});

// ---- 1. one season ahead vs goalies.workloadTable
{
  const bandAge: Record<string, number> = { "<=24": 23, "25-27": 26, "28-30": 29, "31-33": 32, "34-35": 34.5, "36+": 37 };
  const tierShare: Record<string, number> = { starter: 0.68, tandem: 0.4, backup: 0.2 };
  for (const [band, age] of Object.entries(bandAge)) {
    for (const [tier, s0] of Object.entries(tierShare)) {
      const h = fx.workload[`${band}|${tier}`]!;
      // a league-average goalie at that workload
      const r = simulatePlayer(goalie(`w${band}${tier}`, age, s0, gg.svLeague + gg.svWorkload * s0), ctx(3000, "|goalie-roles"));
      let st = 0;
      let tan = 0;
      let gs = 0;
      for (let n = 0; n < r.N; n++) {
        const s = r.gamesPath![1]![n]! / SG;
        if (s >= 0.5) st++;
        if (s >= 0.3) tan++;
        gs += s;
      }
      const tol = h.n >= 80 ? 0.1 : 0.15;
      const pS = st / r.N;
      const pT = tan / r.N;
      const es = gs / r.N;
      assert(Math.abs(pS - h.pStarterNext) <= tol, `${band} ${tier}: P(starter next) ${pS.toFixed(2)} vs ${h.pStarterNext} (±${tol})`);
      assert(Math.abs(pT - h.pAtLeastTandemNext) <= tol, `${band} ${tier}: P(≥ tandem next) ${pT.toFixed(2)} vs ${h.pAtLeastTandemNext} (±${tol})`);
      assert(Math.abs(es - h.expGsShareNext) <= tol * 0.7, `${band} ${tier}: E[start share next] ${es.toFixed(3)} vs ${h.expGsShareNext}`);
    }
  }
}

// ---- 2. end to end: FP totals relative to year 1 (goalies.horizon) by age at year 1
const horizonRatios: string[] = [];
{
  const bands: Array<[string, number, number, number, number]> = [
    // name, a1 from, a1 to, allowed below history, allowed above history
    ["22-25", 22, 25, 0.15, 0.07],
    ["26-28", 26, 28, 0.07, 0.07],
    ["29-31", 29, 31, 0.07, 0.07],
    ["32-34", 32, 34, 0.07, 0.07],
    ["35+", 35, 99, 0.15, 0.07],
  ];
  const N = 200;
  for (const [name, lo, hi, below, above] of bands) {
    const rows = fx.horizon.filter((r) => r.a1 >= lo && r.a1 <= hi);
    const hist = [0, 0, 0, 0, 0];
    const hist1 = [0, 0, 0, 0, 0];
    const model = [0, 0, 0, 0, 0];
    rows.forEach((row, i) => {
      const r = simulatePlayer(goalie(`h${name}${i}`, row.a1 + 0.5, row.gs1, Math.max(2.5, row.fpg1)), ctx(N, "|goalie-horizon"));
      const e = r.fp.map((a) => a.reduce((s, x) => s + x, 0) / N);
      for (let k = 1; k <= 3 && k < row.fp.length; k++) {
        hist[k] += row.fp[k]!;
        hist1[k] += row.fp[0]!;
        // the model's ratio, weighted like the historical sum
        model[k] += (e[k]! / e[0]!) * row.fp[0]!;
      }
    });
    const cells: string[] = [];
    for (let k = 1; k <= 3; k++) {
      const h = hist[k]! / hist1[k]!;
      const m = model[k]! / hist1[k]!;
      cells.push(`k${k + 1} ${m.toFixed(2)}/${h.toFixed(2)}`);
      assert(m >= h - below && m <= h + above, `goalies ${name} at year 1: FP ratio at year ${k + 1} ${m.toFixed(2)} vs history ${h.toFixed(2)} (−${below}/+${above})`);
    }
    horizonRatios.push(`${name} ${cells.join(" ")}`);
  }
}

// ---- 3. the logistics take the raw games-started share
{
  const tandem = ret.goalieRoleNext(28, 0.45, 0);
  assert(tandem.pS < 0.5, `a 28-year-old tandem goalie (45% of starts) is not favoured to start next season (${tandem.pS.toFixed(2)})`);
  assert(tandem.pS <= tandem.pT && tandem.pT <= tandem.pP && tandem.pP <= 1, "cumulative role probabilities");
  const starter = ret.goalieRoleNext(28, 0.7, 0);
  assert(starter.pS > 0.65 && starter.pS < 0.85, `a 28-year-old starter (70%) keeps the job about 3 times in 4 (${starter.pS.toFixed(2)})`);
  assert(ret.pStarterNext(28, 0.45, 0) === tandem.pS, "pStarterNext is the starter branch of the role model");
}

if (failed > 0) {
  console.error(`test-dynasty-goalies: ${failed} failure(s)`);
  process.exit(1);
}
console.log(`OK: dynasty goalies (workload table by age × tier; horizon model/history ${horizonRatios.join("; ")})`);
