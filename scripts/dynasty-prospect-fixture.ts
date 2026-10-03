/**
 * Freeze the walk-forward prospect fixture of the CI guard
 * (scripts/test-dynasty-nhle.ts, scripts/fixtures/dynasty-prospect-wf2019.json):
 *  - rows: every drafted skater of the classes Y0 − 6 … Y0 with fewer than
 *    100 NHL GP before Y0 and under 25, at the start year Y0 = 2019, with
 *    what was known then (draft slot, age, height, his league seasons before
 *    Y0) and what happened next (200 NHL GP within 7 seasons; Captains
 *    season gains over Y0 … Y0 + 4 when he played);
 *  - model: the NHLe model fitted as of Y0 (scripts/dynasty-prospect-fit.ts:
 *    training snapshots s ≤ Y0 − 7, league factors from season pairs before
 *    Y0), so these rows are out of its sample (the 2013-2019 classes enter
 *    none of its training snapshots);
 *  - procedureHash: the fitting procedure it was frozen with
 *    (scripts/dynasty-model-hash.ts).
 *
 * The guard scores the frozen model on the rows (out of sample) against the
 * draft slot, and the shipped model on the same rows (in sample: the shipped
 * fit at 2026 trains on these classes, so that part is only a sanity check).
 * A change of procedure fails the guard until this fixture is refrozen, so
 * the new procedure is scored out of sample again.
 *
 * Run: npx tsx scripts/dynasty-prospect-fixture.ts --hist <hist.json> --cache <dir>
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { seasonRows } from "../src/lib/dynasty/nhle";
import { parseParams } from "../src/lib/dynasty/params";
import { replacement } from "../src/lib/dynasty/scale";
import { ageOn, fpgCaptains, loadHist, loadProspectHistory, seasonGames } from "./dynasty-backtest-lib";
import { procedureHash } from "./dynasty-model-hash";
import { fitProspectModel } from "./dynasty-prospect-fit";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const HIST = arg("--hist") ?? process.env.DYNASTY_HIST;
const CACHE = arg("--cache") ?? process.env.DYNASTY_CACHE;
if (!HIST || !CACHE) {
  console.error("dynasty-prospect-fixture: --hist <file> and --cache <dir> are required");
  process.exit(2);
}
const H = loadHist(HIST);
const PH = loadProspectHistory(CACHE);
const p = parseParams(JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")));
const repl = replacement(p);
const Y0 = 2019;

export interface FixtureRow {
  y0: number;
  pos: "F" | "D";
  pick: number;
  draftYear: number;
  age: number;
  height: number | null;
  /** [start year, league, GP, points] before y0 (international events left out). */
  rows: Array<[number, string, number, number]>;
  /** 200+ NHL GP by the end of y0 + 6 (career). */
  made: 0 | 1;
  /** Captains season gains (league-1 FP above the waiver line + captain premium), y0 … y0 + 4. */
  real5: number;
}

const out: FixtureRow[] = [];
for (const d of PH.picks) {
  if (d.pos === "G" || d.year < Y0 - 6 || d.year > Y0) continue;
  const g = d.pos === "D" ? "D" : "F";
  const land = d.id != null ? PH.landing.get(d.id) : undefined;
  const birth = land?.birthDate ?? null;
  const age = ageOn(birth ?? `${d.year - 18}-06-01`, Y0)!;
  if (age >= 25) continue;
  const all = land ? seasonRows(land.seasonTotals) : [];
  const nhlBefore = all.filter((r) => r.league === "NHL" && r.year < Y0).reduce((a, r) => a + r.gp, 0);
  if (nhlBefore >= 100) continue;
  const nhlThrough = all.filter((r) => r.league === "NHL" && r.year <= Y0 + 6).reduce((a, r) => a + r.gp, 0);
  let real5 = 0;
  const hp = d.id != null ? H.players[String(d.id)] : undefined;
  for (let y = Y0; y < Y0 + 5; y++) {
    const s = hp?.sk[y];
    if (!s || !(s.gp > 0)) continue;
    const f = fpgCaptains(p, g, y, s);
    const games = s.gp * (82 / seasonGames(y));
    const R = g === "D" ? repl.D : repl.F;
    real5 += Math.max(0, (f - R) * games + (g === "F" ? 0.5 * Math.max(0, f - repl.offRef) * games : 0));
  }
  out.push({
    y0: Y0,
    pos: g,
    pick: d.pick,
    draftYear: d.year,
    age: Math.round(age * 100) / 100,
    height: d.height ?? land?.heightInInches ?? null,
    rows: all.filter((r) => r.year < Y0 && (r.year >= Y0 - 2 || r.league === "NHL") && r.gp >= 3).map((r) => [r.year, r.league, r.gp, r.pts]),
    made: nhlThrough >= 200 ? 1 : 0,
    real5: Math.round(real5 * 10) / 10,
  });
}

// the model as of Y0 (walk-forward)
const fitted = fitProspectModel(H, PH, p, Y0);
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;
const model = {
  version: fitted.version,
  make: fitted.make.map(r6),
  prime: { coef: fitted.prime.coef.map(r6), sd: r6(fitted.prime.sd) },
  lag: { coef: fitted.lag.coef.map(r6), min: fitted.lag.min, max: fitted.lag.max },
  oddsCal: fitted.oddsCal ?? 1,
  factors: Object.fromEntries(Object.entries(fitted.factors).map(([k, v]) => [k, { f: r6(v.f), n: Math.round(v.n) }])),
};

const path = join(process.cwd(), "scripts", "fixtures", "dynasty-prospect-wf2019.json");
writeFileSync(
  path,
  JSON.stringify({
    source: `scripts/dynasty-prospect-fixture.ts: drafted skaters of classes Y0-6..Y0 under 100 NHL GP and 25, Y0 = ${Y0}; league seasons before Y0 from public NHL landings; outcomes from the NHL history (2008-09..2025-26). model: the NHLe model fitted as of Y0 (walk-forward: these rows are out of its sample).`,
    procedureHash: procedureHash(),
    model,
    rows: out,
  }) + "\n",
);
console.log(`OK: ${out.length} rows (${out.filter((r) => r.made).length} made), model ${model.version} → ${path}`);
