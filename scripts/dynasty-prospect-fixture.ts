/**
 * Freeze a compact prospect evaluation set for the CI guard
 * (scripts/test-dynasty-nhle.ts): every drafted skater of the classes
 * Y0 − 6 … Y0 with fewer than 100 NHL GP before Y0 and under 25, at the start
 * year Y0 = 2019, with what was known then (draft slot, age,
 * height, his league seasons before Y0) and what happened next (200 NHL GP
 * within 7 seasons; Captains season gains over Y0 … Y0 + 4 when he played).
 *
 * The guard recomputes P(make it) and the prime from the committed model
 * (src/data/dynasty/prospect-model.json) on these rows and requires them to
 * beat the draft slot. It is a regression guard (the shipped model is
 * fitted on every class, these included); the honest out-of-sample numbers
 * are the walk-forward backtest's (scripts/dynasty-backtest.ts).
 *
 * Run: npx tsx scripts/dynasty-prospect-fixture.ts --hist <hist.json> --cache <dir>
 */
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { seasonRows } from "../src/lib/dynasty/nhle";
import { parseParams } from "../src/lib/dynasty/params";
import { replacement } from "../src/lib/dynasty/scale";
import { ageOn, fpgCaptains, loadHist, loadProspectHistory, seasonGames } from "./dynasty-backtest-lib";

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
for (const y0 of [2019]) {
  for (const d of PH.picks) {
    if (d.pos === "G" || d.year < y0 - 6 || d.year > y0) continue;
    const g = d.pos === "D" ? "D" : "F";
    const land = d.id != null ? PH.landing.get(d.id) : undefined;
    const birth = land?.birthDate ?? null;
    const age = ageOn(birth ?? `${d.year - 18}-06-01`, y0)!;
    if (age >= 25) continue;
    const all = land ? seasonRows(land.seasonTotals) : [];
    const nhlBefore = all.filter((r) => r.league === "NHL" && r.year < y0).reduce((a, r) => a + r.gp, 0);
    if (nhlBefore >= 100) continue;
    const nhlThrough = all.filter((r) => r.league === "NHL" && r.year <= y0 + 6).reduce((a, r) => a + r.gp, 0);
    let real5 = 0;
    const hp = d.id != null ? H.players[String(d.id)] : undefined;
    for (let y = y0; y < y0 + 5; y++) {
      const s = hp?.sk[y];
      if (!s || !(s.gp > 0)) continue;
      const f = fpgCaptains(p, g, y, s);
      const games = s.gp * (82 / seasonGames(y));
      const R = g === "D" ? repl.D : repl.F;
      real5 += Math.max(0, (f - R) * games + (g === "F" ? 0.5 * Math.max(0, f - repl.offRef) * games : 0));
    }
    out.push({
      y0,
      pos: g,
      pick: d.pick,
      draftYear: d.year,
      age: Math.round(age * 100) / 100,
      height: d.height ?? land?.heightInInches ?? null,
      rows: all.filter((r) => r.year < y0 && (r.year >= y0 - 2 || r.league === "NHL") && r.gp >= 3).map((r) => [r.year, r.league, r.gp, r.pts]),
      made: nhlThrough >= 200 ? 1 : 0,
      real5: Math.round(real5 * 10) / 10,
    });
  }
}
const path = join(process.cwd(), "scripts", "fixtures", "dynasty-prospect-holdout.json");
writeFileSync(
  path,
  JSON.stringify({
    source: "scripts/dynasty-prospect-fixture.ts: drafted skaters of classes Y0-6..Y0 under 100 NHL GP and 25, Y0 = 2019; league seasons before Y0 from public NHL landings; outcomes from the NHL history (2008-09..2025-26).",
    rows: out,
  }) + "\n",
);
console.log(`OK: ${out.length} rows (${out.filter((r) => r.made).length} made) → ${path}`);
