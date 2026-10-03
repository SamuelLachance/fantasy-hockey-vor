/**
 * NHLe prospect model (src/lib/dynasty/nhle.ts, src/data/dynasty/prospect-model.json):
 * league rows and aliases, the season-pair factors on a synthetic league,
 * monotonicity of the predictions, the committed model's shape, and a
 * regression guard on a frozen evaluation set (scripts/fixtures/
 * dynasty-prospect-holdout.json, classes 2013-2019 at Oct 1, 2019): the
 * committed model must keep beating the draft-slot route on P(200 NHL GP)
 * (AUC) and on the realized Captains value of the next five seasons
 * (Spearman), by the margins below. The honest out-of-sample numbers are the
 * walk-forward backtest's (prospect-model.json `backtest`).
 * Run: npx tsx scripts/test-dynasty-nhle.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  design,
  DESIGN_NAMES,
  fitLeagueFactors,
  normalizeLeague,
  predictProspect,
  prospectFeatures,
  seasonRows,
  type LandingSeason,
  type ProspectModelV2,
} from "../src/lib/dynasty/nhle";
import { parseParams } from "../src/lib/dynasty/params";
import { slotProspect } from "../src/lib/dynasty/prospect";
import { replacement } from "../src/lib/dynasty/scale";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const root = process.cwd();
const params = parseParams(JSON.parse(readFileSync(join(root, "src", "data", "dynasty", "params.json"), "utf8")));
const model = JSON.parse(readFileSync(join(root, "src", "data", "dynasty", "prospect-model.json"), "utf8")) as ProspectModelV2 & {
  backtest?: Record<string, unknown>;
};

// ---- league rows
const S = (y: number, league: string, gp: number, p: number, gt = 2): LandingSeason => ({ season: y * 10000 + y + 1, league, gt, gp, p });
{
  const rows = seasonRows([S(2022, "NCAA", 36, 30), S(2022, "H-East", 24, 20), S(2022, "WJC-20", 7, 9), S(2023, "OHL", 30, 20), S(2023, "OHL", 25, 25), S(2023, "OHL", 10, 9, 3)]);
  const ncaa = rows.find((r) => r.year === 2022 && r.league === "NCAA");
  assert(rows.length === 2, `rows: conference merged into NCAA, tournament and playoffs left out (${JSON.stringify(rows)})`);
  assert(ncaa?.gp === 36 && ncaa.pts === 30, "NCAA keeps the full-season row, not the conference subset");
  const ohl = rows.find((r) => r.league === "OHL");
  assert(ohl?.gp === 55 && ohl.pts === 45, "a trade inside a league sums the team rows");
  assert(seasonRows([S(2023, "OHL", 30, 20)], 2023).length === 0, "`before` cuts seasons from that start year on");
  assert(normalizeLeague("Sweden") === "SHL" && normalizeLeague("WJC-20") === null, "aliases and exclusions");
}

// ---- season-pair factors recover a synthetic league's ratio
{
  const players: LandingSeason[][] = [];
  for (let i = 0; i < 80; i++) {
    const ppg = 0.5 + (i % 10) * 0.08;
    players.push([S(2015, "XHL", 60, Math.round(ppg * 60)), S(2016, "NHL", 60, Math.round(ppg * 0.4 * 60))]);
  }
  const f = fitLeagueFactors(players, 2020, 20, 0);
  assert(Math.abs(f.XHL!.f - 0.4) < 0.02, `synthetic factor 0.4 recovered (${f.XHL?.f})`);
  const fNone = fitLeagueFactors(players, 2016, 20, 0);
  assert(!fNone.XHL, "pairs whose second season starts at `before` are not used (walk-forward)");
}

// ---- committed model: shape, finite coefficients
{
  const n = DESIGN_NAMES.length;
  assert(model.make.length === n && model.prime.coef.length === n && model.lag.coef.length === n, "coefficient vectors match the design");
  assert([...model.make, ...model.prime.coef, ...model.lag.coef, model.prime.sd].every(Number.isFinite), "finite coefficients");
  assert(model.factors.AHL != null && model.factors.AHL.f > 0.3 && model.factors.AHL.f < 0.7, `AHL factor plausible (${model.factors.AHL?.f})`);
  assert(model.factors.OHL != null && model.factors.OHL.f < model.factors.AHL!.f, "junior below the AHL");
}

// ---- monotone predictions
{
  const base = { pos: "F" as const, pick: 40, draftYear: 2025, age: 19.3, heightIn: 72, seasons: [S(2025, "OHL", 60, 60)] };
  const pm = (x: typeof base) => predictProspect(model, prospectFeatures(x, 2026, model.factors), 2026, params.prospect.primeFloor.F);
  const a = pm(base);
  const better = pm({ ...base, seasons: [S(2025, "OHL", 60, 100)] });
  const earlier = pm({ ...base, pick: 5 });
  const older = pm({ ...base, age: 21.3 });
  assert(better.pMake > a.pMake && better.pi.mu > a.pi.mu, `more junior points: higher P(make) and prime (${a.pMake.toFixed(3)} → ${better.pMake.toFixed(3)})`);
  assert(earlier.pMake > a.pMake, "an earlier pick: higher P(make)");
  assert(older.pMake < a.pMake, "the same production two years older: lower P(make)");
  assert(a.eta >= 2026 && a.eta <= 2032, `ETA in range (${a.eta})`);
  assert(design(prospectFeatures(base, 2026, model.factors)).length === DESIGN_NAMES.length, "design length");
}

// ---- regression guard on the frozen evaluation set
{
  const fx = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "dynasty-prospect-holdout.json"), "utf8")) as {
    rows: Array<{ y0: number; pos: "F" | "D"; pick: number; draftYear: number; age: number; height: number | null; rows: Array<[number, string, number, number]>; made: 0 | 1; real5: number }>;
  };
  const repl = replacement(params);
  const pNew: number[] = [];
  const pSlot: number[] = [];
  const vNew: number[] = [];
  const vSlot: number[] = [];
  const made: number[] = [];
  const real: number[] = [];
  for (const r of fx.rows) {
    const seasons = r.rows.map(([y, league, gp, pts]) => S(y, league, gp, pts));
    const n = predictProspect(model, prospectFeatures({ pos: r.pos, pick: r.pick, draftYear: r.draftYear, age: r.age, heightIn: r.height, seasons }, r.y0, model.factors), r.y0, params.prospect.primeFloor[r.pos]);
    const s = slotProspect(params, r.pos, { year: r.draftYear, pick: r.pick }, r.y0);
    const R = r.pos === "D" ? repl.D : repl.F;
    pNew.push(n.pMake);
    pSlot.push(s.pMake);
    vNew.push(n.pMake * Math.max(0.05, n.pi.mu - R));
    vSlot.push(s.pMake * Math.max(0.05, s.pi.mu - R));
    made.push(r.made);
    real.push(r.real5);
  }
  const aucN = auc(pNew, made);
  const aucS = auc(pSlot, made);
  const spN = spearman(vNew, real);
  const spS = spearman(vSlot, real);
  console.log(`guard: AUC ${aucN.toFixed(3)} vs slot ${aucS.toFixed(3)}; Spearman (5-season Captains value) ${spN.toFixed(3)} vs slot ${spS.toFixed(3)} (${fx.rows.length} prospects)`);
  assert(aucN >= aucS + 0.05 && aucN >= 0.8, `P(200 GP) AUC ${aucN.toFixed(3)} must beat the slot ${aucS.toFixed(3)} by 0.05 and reach 0.80`);
  assert(spN >= spS + 0.04, `value Spearman ${spN.toFixed(3)} must beat the slot ${spS.toFixed(3)} by 0.04`);
  const bt = model.backtest as { gate?: Record<string, number> } | undefined;
  assert(!!bt?.gate, "prospect-model.json records the walk-forward backtest that justified it (backtest.gate)");
  if (bt?.gate) for (const [k, v] of Object.entries(bt.gate)) assert(v > 0, `walk-forward gain ${k} = ${v} must stay positive`);
}

function ranks(x: readonly number[]): number[] {
  const s = x.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(x.length);
  for (let i = 0; i < s.length; ) {
    let j = i;
    while (j + 1 < s.length && s[j + 1]![0] === s[i]![0]) j++;
    for (let k = i; k <= j; k++) r[s[k]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function spearman(a: readonly number[], b: readonly number[]): number {
  const ra = ranks(a);
  const rb = ranks(b);
  const n = a.length;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  const mb = rb.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (ra[i]! - ma) * (rb[i]! - mb);
    aa += (ra[i]! - ma) ** 2;
    bb += (rb[i]! - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}
function auc(p: readonly number[], y: readonly number[]): number {
  const r = ranks(p);
  let sumPos = 0;
  let nPos = 0;
  for (let i = 0; i < p.length; i++) if (y[i]) {
    sumPos += r[i]! + 1;
    nPos++;
  }
  const nNeg = p.length - nPos;
  return (sumPos - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
}

if (failed) {
  console.error(`test-dynasty-nhle: ${failed} failure(s)`);
  process.exit(1);
}
console.log("OK: test-dynasty-nhle");
