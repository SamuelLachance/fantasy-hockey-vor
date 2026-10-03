/**
 * NHLe prospect model (src/lib/dynasty/nhle.ts, src/data/dynasty/prospect-model.json):
 * league rows and aliases, the season-pair factors on a synthetic league,
 * monotonicity of the predictions, the committed model's shape, and the
 * guards of its walk-forward evidence:
 *  - scripts/fixtures/dynasty-prospect-wf2019.json (classes 2013-2019 at
 *    Oct 1, 2019, and the model fitted as of 2019, so out of sample): that
 *    model must beat the draft-slot route on P(200 NHL GP) (AUC) and on the
 *    realized Captains value of the next five seasons (Spearman) by the
 *    margins below; the shipped model on the same rows is only an in-sample
 *    sanity check (it trains on these classes);
 *  - the fixture and the recorded backtest (prospect-model.json `backtest`)
 *    must carry the fingerprint of the current fitting procedure
 *    (scripts/dynasty-model-hash.ts): a change to nhle.ts or
 *    scripts/dynasty-prospect-fit.ts fails here until the backtest is re-run
 *    and re-recorded and the fixture refrozen;
 *  - the recorded backtest's gate cells (Spearman gains over the draft-slot
 *    route whose 90 % interval excluded 0) stay positive;
 *  - the long-term top-200 prospect gate (src/lib/dynasty/checks.ts) covers
 *    the realized counts the backtest recorded, with at most a few of slack.
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
import { GATES } from "../src/lib/dynasty/checks";
import { procedureHash } from "./dynasty-model-hash";

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

// ---- walk-forward guard on the frozen 2019 fixture
const HASH = procedureHash(root);
{
  const fx = JSON.parse(readFileSync(join(root, "scripts", "fixtures", "dynasty-prospect-wf2019.json"), "utf8")) as {
    procedureHash: string;
    model: ProspectModelV2;
    rows: Array<{ y0: number; pos: "F" | "D"; pick: number; draftYear: number; age: number; height: number | null; rows: Array<[number, string, number, number]>; made: 0 | 1; real5: number }>;
  };
  assert(fx.procedureHash === HASH, `the walk-forward fixture was frozen with procedure ${fx.procedureHash}, the code is ${HASH}: refreeze it (scripts/dynasty-prospect-fixture.ts)`);
  const repl = replacement(params);
  const score = (m: ProspectModelV2) => {
    const p: number[] = [];
    const v: number[] = [];
    for (const r of fx.rows) {
      const seasons = r.rows.map(([y, league, gp, pts]) => S(y, league, gp, pts));
      const n = predictProspect(m, prospectFeatures({ pos: r.pos, pick: r.pick, draftYear: r.draftYear, age: r.age, heightIn: r.height, seasons }, r.y0, m.factors), r.y0, params.prospect.primeFloor[r.pos]);
      const R = r.pos === "D" ? repl.D : repl.F;
      p.push(n.pMake);
      v.push(n.pMake * Math.max(0.05, n.pi.mu - R));
    }
    return { p, v };
  };
  const pSlot: number[] = [];
  const vSlot: number[] = [];
  for (const r of fx.rows) {
    const s = slotProspect(params, r.pos, { year: r.draftYear, pick: r.pick }, r.y0);
    const R = r.pos === "D" ? repl.D : repl.F;
    pSlot.push(s.pMake);
    vSlot.push(s.pMake * Math.max(0.05, s.pi.mu - R));
  }
  const made = fx.rows.map((r) => r.made);
  const real = fx.rows.map((r) => r.real5);
  const wf = score(fx.model);
  const shipped = score(model);
  const aucS = auc(pSlot, made);
  const spS = spearman(vSlot, real);
  const aucW = auc(wf.p, made);
  const spW = spearman(wf.v, real);
  console.log(
    `guard (${fx.rows.length} prospects, 2019): walk-forward model AUC ${aucW.toFixed(3)} / Spearman ${spW.toFixed(3)}; slot ${aucS.toFixed(3)} / ${spS.toFixed(3)}; shipped (in sample) ${auc(shipped.p, made).toFixed(3)} / ${spearman(shipped.v, real).toFixed(3)}`,
  );
  // out of sample (model fitted as of 2019); frozen 2026-10-02: AUC 0.850 vs slot 0.732, Spearman 0.384 vs slot 0.256
  assert(aucW >= aucS + 0.08, `walk-forward P(200 GP) AUC ${aucW.toFixed(3)} must beat the slot ${aucS.toFixed(3)} by 0.08`);
  assert(spW >= spS + 0.07, `walk-forward value Spearman ${spW.toFixed(3)} must beat the slot ${spS.toFixed(3)} by 0.07`);
  // in sample: a sanity check of the shipped coefficients, not evidence
  assert(auc(shipped.p, made) >= aucS + 0.05, "shipped model (in sample) beats the slot on AUC");
}

// ---- the recorded walk-forward backtest
{
  const bt = model.backtest as
    | { procedureHash?: string; gate?: Record<string, number>; top200?: Record<string, { years: number[]; realized: number[]; by: Record<string, number[]> }> }
    | undefined;
  assert(!!bt?.gate, "prospect-model.json records the walk-forward backtest that justified it (backtest.gate)");
  assert(bt?.procedureHash === HASH, `the recorded backtest scored procedure ${bt?.procedureHash}, the code is ${HASH}: re-run scripts/dynasty-backtest.ts and scripts/dynasty-scorecard.ts --record`);
  if (bt?.gate) {
    assert(Object.keys(bt.gate).length >= 6, `at least 6 gate cells (${Object.keys(bt.gate).length})`);
    for (const [k, v] of Object.entries(bt.gate)) assert(v > 0, `walk-forward gain ${k} = ${v} must stay positive`);
  }
  // the long-term top-200 prospect gate is the realized range of the backtest, with a little slack
  const t = bt?.top200;
  assert(!!t && Object.keys(t).length > 0, "the backtest records the prospects in the realized long-term top 200 (backtest.top200)");
  if (t) {
    // the gate runs on the Captains board (scripts/check-fantrax-data.ts)
    const realized = (t.captains ?? Object.values(t)[0]!).realized;
    const lo = Math.min(...realized);
    const hi = Math.max(...realized);
    const [glo, ghi] = GATES.top200ProspectsLongTerm;
    assert(glo <= lo && ghi >= hi, `gate ${glo}-${ghi} covers the realized counts ${lo}-${hi}`);
    assert(lo - glo <= 8 && ghi - hi <= 5, `gate ${glo}-${ghi} stays near the realized counts ${lo}-${hi} (slack ≤ 8 below, ≤ 5 above)`);
  }
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
