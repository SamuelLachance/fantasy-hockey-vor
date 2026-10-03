/**
 * Walk-forward backtest of the dynasty engine in BOTH dynasty leagues'
 * scoring (Captains Dynasty: league-1 FP above the waiver line + captain
 * premium; Slapshot: G 3.5 A 2.5 SOG 0.25 Hit 0.15 SB 0.3 PPP/SHG shares
 * above its 32-team replacement), against simple baselines.
 *
 * As of Oct 1 of each start year Y0, every input uses only seasons < Y0
 * (NHL history, landing seasons of the prospects, draft slots, birth
 * dates; the NHLe model is refitted on draft-class snapshots whose
 * 7-season outcome was complete before Y0). Universe: skaters with an NHL
 * season in Y0-2 or Y0-1 (Marcel 5/4/3 projection regressed 125 games toward
 * 0.9 × the position mean, games share 5/4/3 shrunk 20 % toward 0.75) and
 * every drafted skater of classes Y0-6 … Y0 without such a season
 * (never-NHL picks included: realized 0).
 *
 * Variants (--variants, comma list):
 *   base   the engine as committed (prospects: the draft-slot route, the only
 *          one reproducible at past dates; the live board's research records
 *          are frozen 2026 files)
 *   nhle   prospects (and draftees under 100 NHL GP) carry an NHLe record
 *          from src/lib/dynasty/nhle.ts fitted walk-forward
 *   PATCH  env JSON merged into params.json for every variant (experiments)
 *
 * Output: one rows file per (variant, league, Y0) in --out (season gains
 * realized and expected, the baselines), read by scripts/dynasty-scorecard.ts.
 *
 * Run: npx tsx scripts/dynasty-backtest.ts --hist <hist.json> --cache <dir>
 *        [--years 2015,…] [--paths 1000] [--leagues captains,slapshot]
 *        [--variants base,nhle] --out <dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildDynasty } from "../src/lib/dynasty/index";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { replacement } from "../src/lib/dynasty/scale";
import type { DynastyInput, ProspectRecord } from "../src/lib/dynasty/types";
import { predictProspect, prospectFeatures, type ProspectModelV2 } from "../src/lib/dynasty/nhle";
import {
  LAST_SEASON,
  ageOn,
  fpgCaptains,
  fpgSlapshot,
  line,
  loadHist,
  loadProspectHistory,
  seasonGames,
  type HistPlayer,
  type ProspectHistory,
  type Sk,
} from "./dynasty-backtest-lib";
import { fitProspectModel } from "./dynasty-prospect-fit";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const HIST = arg("--hist") ?? process.env.DYNASTY_HIST;
const CACHE = arg("--cache") ?? process.env.DYNASTY_CACHE;
const OUT = arg("--out");
if (!HIST || !OUT) {
  console.error("dynasty-backtest: --hist <file> and --out <dir> are required (--cache <dir> for the nhle variant)");
  process.exit(2);
}
const YEARS = (arg("--years") ?? "2015,2016,2017,2018,2019,2020,2021,2022,2023").split(",").map(Number);
const PATHS = Number(arg("--paths") ?? 1000);
const LEAGUES = (arg("--leagues") ?? "captains,slapshot").split(",") as Array<"captains" | "slapshot">;
const VARIANTS = (arg("--variants") ?? "base,nhle").split(",");
const TAG = arg("--tag") ?? "";
/** Captains without the keeper economy (K = 0, no gate): talent value in its scoring, comparable with the realized gains. */
const NOK = args.includes("--noK");

const H = loadHist(HIST);
const PH: ProspectHistory | null = CACHE ? loadProspectHistory(CACHE) : null;

function merge(a: Record<string, unknown>, b: Record<string, unknown>) {
  for (const k of Object.keys(b)) {
    const bv = b[k];
    const av = a[k];
    if (bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object") merge(av as Record<string, unknown>, bv as Record<string, unknown>);
    else a[k] = bv;
  }
}
function paramsFor(y0: number, patch?: string): DynastyParams {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8"));
  raw.firstSeasonYear = y0;
  raw.games.seasonGames = 82;
  raw.market.enabled = false;
  if (process.env.PATCH) merge(raw, JSON.parse(process.env.PATCH));
  if (patch) merge(raw, JSON.parse(patch));
  return parseParams(raw);
}

export interface BtRow {
  id: string;
  n: string;
  g: "F" | "D";
  prospect: boolean;
  route: string;
  age: number | null;
  pick: number | null;
  draftYear: number | null;
  dv: number;
  /** Model E[G_t], t = 0 … 5. */
  eG: number[];
  /** Realized season gains (league scoring), t = 0 … LAST − Y0. */
  real: number[];
  /** Realized league FP per season (raw production). */
  realFp: number[];
  /** Baselines per season t = 0 … 5: Marcel × aging curve (bAge), Marcel flat (bProj); last season's value (bLast). */
  bAge: number[];
  bProj: number;
  bLast: number;
  pMake?: number;
  /** Marcel FP/G in the league's scoring, projected games, replacement per game (offline baselines). */
  proj?: number;
  projGp?: number;
  R?: number;
  /** Realized games per season (82-game scale). */
  games?: number[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

function runYear(y0: number, variant: string, league: "captains" | "slapshot", model: ProspectModelV2 | null): BtRow[] {
  const p = paramsFor(y0);
  const repl = replacement(p);
  const posMean: Record<string, number> = {};
  const slapMean: Record<string, number> = {};
  for (const y of [y0 - 1, y0 - 2, y0 - 3]) {
    for (const g of ["F", "D"] as const) {
      let a = 0;
      let b = 0;
      let n = 0;
      for (const pl of Object.values(H.players)) {
        const s = pl.sk[y];
        if (pl.pos !== g || !s || s.gp < 40) continue;
        a += fpgCaptains(p, g, y, s) * s.gp;
        b += fpgSlapshot(g, s) * s.gp;
        n += s.gp;
      }
      posMean[`${g}${y}`] = a / n;
      slapMean[`${g}${y}`] = b / n;
    }
  }
  const R_MARCEL = 125;
  const W = [5, 4, 3];
  interface Meta {
    g: "F" | "D";
    age: number | null;
    proj: number | null;
    projS: number | null;
    projGp: number | null;
    lastC: number;
    lastS: number;
    prospect: boolean;
    pick: number | null;
    draftYear: number | null;
    histId: string | null;
  }
  const inputs: DynastyInput[] = [];
  const meta = new Map<string, Meta>();
  const draftByHist = new Map<string, { year: number; pick: number }>();
  for (const d of H.draftees) if (d.id != null) draftByHist.set(String(d.id), { year: d.year, pick: d.pick });
  for (const [id, pl] of Object.entries(H.players)) {
    if (pl.pos === "G") continue;
    const g = pl.pos;
    const past = Object.entries(pl.sk)
      .map(([y, s]) => [Number(y), s] as const)
      .filter(([y]) => y < y0)
      .sort((a, b) => a[0] - b[0]);
    if (!past.length) continue;
    const recent = past.filter(([y]) => y >= y0 - 3);
    if (!recent.some(([y]) => y >= y0 - 2)) continue;
    const careerGp = past.reduce((a, [, s]) => a + s.gp, 0);
    let num = 0;
    let numS = 0;
    let den = 0;
    for (const [y, s] of recent) {
      const w = W[y0 - 1 - y]!;
      num += w * s.gp * fpgCaptains(p, g, y, s);
      numS += w * s.gp * fpgSlapshot(g, s);
      den += w * s.gp;
    }
    const proj = (num + R_MARCEL * posMean[`${g}${y0 - 1}`]! * 0.9) / (den + R_MARCEL);
    const projS = (numS + R_MARCEL * slapMean[`${g}${y0 - 1}`]! * 0.9) / (den + R_MARCEL);
    const debut = past[0]![0];
    let sn = 0;
    let sd = 0;
    for (let k = 0; k < 3; k++) {
      const y = y0 - 1 - k;
      if (y < debut) continue;
      sn += W[k]! * Math.min(1, (pl.sk[y]?.gp ?? 0) / seasonGames(y));
      sd += W[k]!;
    }
    const projGp = Math.round(82 * (0.8 * (sn / sd) + 0.2 * 0.75));
    const off = (proj - p.scale[g].a) / p.scale[g].b;
    const lastS = pl.sk[y0 - 1];
    const draft = pl.draft ?? draftByHist.get(id);
    inputs.push({
      id,
      n: pl.n,
      e: g === "D" ? "D,Skt" : "C,F,Skt",
      team: null,
      nhlId: Number(id),
      birthDate: pl.birth ?? null,
      careerGp,
      seasonGp: 0,
      proj: { src: "proj", gp: projGp, off, dx: 0, method: "ml" },
      ...(draft ? { draft, draftSource: "profile" as const } : {}),
      eligNow: null,
      history: past.map(([y, s]) => line(y, s)),
      rostered: false,
    });
    const sc = (x: Sk | undefined, f: (s: Sk) => number) => (x ? f(x) * x.gp * (82 / seasonGames(y0 - 1)) : 0);
    meta.set(id, {
      g,
      age: ageOn(pl.birth, y0),
      proj,
      projS,
      projGp,
      lastC: sc(lastS, (s) => fpgCaptains(p, g, y0 - 1, s)),
      lastS: sc(lastS, (s) => fpgSlapshot(g, s)),
      prospect: false,
      pick: draft?.pick ?? null,
      draftYear: draft?.year ?? null,
      histId: id,
    });
  }
  // prospects: every drafted skater of classes y0-6 … y0 without an NHL season in the window
  const picks = PH
    ? PH.picks.filter((d) => d.year >= y0 - 6 && d.year <= y0 && d.pos !== "G").map((d) => ({ year: d.year, pick: d.pick, pos: d.pos === "D" ? "D" : "F", name: d.name, id: d.id, birth: d.id != null ? (PH.landing.get(d.id)?.birthDate ?? null) : null, height: d.height }))
    : H.draftees.filter((d) => d.year >= y0 - 6 && d.year <= y0 && d.pos !== "G").map((d) => ({ year: d.year, pick: d.pick, pos: d.pos === "D" ? "D" : "F", name: d.name, id: d.id, birth: d.birth, height: null as number | null }));
  for (const d of picks) {
    const id = d.id != null ? String(d.id) : `dr${d.year}-${d.pick}`;
    if (meta.has(id)) continue;
    const pl = d.id != null ? H.players[String(d.id)] : undefined;
    if (pl && Object.keys(pl.sk).some((y) => Number(y) < y0)) continue;
    const g = d.pos as "F" | "D";
    const birth = d.birth ?? pl?.birth ?? `${d.year - 18}-06-01`;
    inputs.push({ id, n: d.name, e: g === "D" ? "D,Skt" : "C,F,Skt", team: null, birthDate: birth, careerGp: 0, seasonGp: 0, draft: { year: d.year, pick: d.pick }, draftSource: "profile", eligNow: null, rostered: false });
    meta.set(id, { g, age: ageOn(birth, y0), proj: null, projS: null, projGp: null, lastC: 0, lastS: 0, prospect: true, pick: d.pick, draftYear: d.year, histId: d.id != null ? String(d.id) : null });
  }

  // ---- variant: NHLe records for draftees under 100 NHL GP (prospect route unless an NHL role)
  const pMakeOf = new Map<string, number>();
  if (variant.startsWith("nhle") && model && PH) {
    for (const inp of inputs) {
      const m = meta.get(inp.id)!;
      if (!inp.draft || (inp.careerGp ?? 0) >= p.eligibility.skaterGp) continue;
      const nhlId = inp.nhlId ?? (m.histId ? Number(m.histId) : null);
      const land = nhlId != null ? PH.landing.get(nhlId) : undefined;
      if (m.age == null || m.age >= p.eligibility.age) continue;
      const f = prospectFeatures(
        { pos: m.g, pick: inp.draft.pick, draftYear: inp.draft.year, age: m.age, heightIn: land?.heightInInches ?? null, seasons: land?.seasonTotals ?? [] },
        y0,
        model.factors,
      );
      const pm = predictProspect(model, f, y0, p.prospect.primeFloor[m.g]);
      pMakeOf.set(inp.id, pm.pMake);
      const rec: ProspectRecord = {
        n: inp.n,
        pos: m.g,
        draft: inp.draft,
        nhlGP: inp.careerGp ?? 0,
        pMake: pm.pMake,
        pSource: "nhle-v2",
        fpgIfMake: pm.pi,
        eta: pm.eta,
        comp: {},
        ...(inp.birthDate ? { birthDate: inp.birthDate } : {}),
      };
      inp.prospect = rec;
    }
  }

  // ---- league profile
  const rS: Record<"F" | "D", number> = { F: 0, D: 0 };
  if (league === "slapshot") {
    // replacement: the best 5 unseated by Marcel Slapshot points (32 × 12 F seats, 32 × 6 D seats)
    for (const [g, seats] of [["F", 384], ["D", 192]] as const) {
      const v = [...meta.values()].filter((m) => !m.prospect && m.g === g && m.projS != null && (m.projGp ?? 0) >= 41).map((m) => m.projS!).sort((a, b) => b - a);
      const pool = v.slice(seats, seats + 5);
      rS[g] = pool.reduce((a, x) => a + x, 0) / Math.max(1, pool.length);
    }
  }
  const kOf = (id: string) => {
    const m = meta.get(id)!;
    if (m.proj != null && m.projS != null && m.proj > 0) return m.projS / m.proj;
    return m.g === "D" ? 1.06 : 1.08;
  };
  const res = buildDynasty(
    { players: inputs, meta: { valuesFetchedAt: "x", stateFetchedAt: "x", projectionsAt: "x", prospectsBuiltAt: "x" } },
    p,
    league === "slapshot"
      ? {
          paths: PATHS,
          market: false,
          K: 0,
          Kgate: 0,
          league: {
            keeperGate: false,
            prepare: (routed) => {
              for (const r of routed) if (r.sim) r.sim.lg = { k: kOf(r.input.id), r: rS[r.g === "D" ? "D" : "F"], rG: 0, capCost: new Array<number>(p.T).fill(0), noEligibility: true };
            },
          },
        }
      : { paths: PATHS, market: false, ...(NOK ? { K: 0, Kgate: 0 } : {}) },
  );

  // ---- realized values and baselines
  const curve = (g: "F" | "D", a: number) => {
    const c = p.curves[g];
    const v = c.values;
    const lo = c.age0;
    const hi = lo + v.length - 1;
    if (a <= lo) return v[0]!;
    if (a >= hi) return v[v.length - 1]! * Math.pow(v[v.length - 1]! / v[v.length - 2]!, a - hi);
    const i = Math.floor(a);
    const f = a - i;
    return v[i - lo]! * (1 - f) + v[i - lo + 1]! * f;
  };
  const rows: BtRow[] = [];
  for (const inp of inputs) {
    const rec = res.all[inp.id]!;
    const m = meta.get(inp.id)!;
    const g = m.g;
    const R = league === "slapshot" ? rS[g] : g === "D" ? repl.D : repl.F;
    const capt = (x: number) => (league === "captains" && g === "F" ? 0.5 * Math.max(0, x - repl.offRef) : 0);
    const fpg = (y: number, s: Sk) => (league === "slapshot" ? fpgSlapshot(g, s) : fpgCaptains(p, g, y, s));
    const pl: HistPlayer | undefined = m.histId ? H.players[m.histId] : undefined;
    const real: number[] = [];
    const realFp: number[] = [];
    const gamesR: number[] = [];
    for (let y = y0; y <= LAST_SEASON; y++) {
      const s = pl?.sk[y];
      if (!s || !(s.gp > 0)) {
        real.push(0);
        realFp.push(0);
        gamesR.push(0);
        continue;
      }
      const f = fpg(y, s);
      const games = s.gp * (82 / seasonGames(y));
      gamesR.push(Math.round(games));
      real.push(r1(Math.max(0, (f - R) * games + capt(f) * games)));
      realFp.push(r1(f * games));
    }
    const pj = league === "slapshot" ? m.projS : m.proj;
    const bAge: number[] = [];
    for (let t = 0; t < 6; t++) {
      if (pj == null || m.age == null || m.age + t >= 38) {
        bAge.push(0);
        continue;
      }
      const x = (pj * curve(g, m.age + t)) / curve(g, m.age);
      bAge.push(r1(Math.max(0, (x - R + capt(x)) * m.projGp!)));
    }
    rows.push({
      id: inp.id,
      n: inp.n,
      g,
      prospect: m.prospect,
      route: res.internals.get(inp.id)!.routed.route,
      age: m.age == null ? null : Math.round(m.age * 10) / 10,
      pick: m.pick,
      draftYear: m.draftYear,
      dv: rec.dv.balanced,
      eG: rec.eG.slice(0, 6).map(r1),
      real,
      realFp,
      bAge,
      bProj: pj != null ? r1(Math.max(0, (pj - R + capt(pj)) * m.projGp!)) : 0,
      bLast: r1(league === "slapshot" ? m.lastS : m.lastC),
      ...(pMakeOf.has(inp.id) ? { pMake: Math.round(pMakeOf.get(inp.id)! * 1000) / 1000 } : {}),
      ...(pj != null ? { proj: Math.round(pj * 1000) / 1000, projGp: m.projGp! } : {}),
      R: Math.round(R * 1000) / 1000,
      games: gamesR,
    });
  }
  return rows;
}

mkdirSync(OUT, { recursive: true });
for (const y0 of YEARS) {
  const needModel = VARIANTS.some((v) => v.startsWith("nhle"));
  const model = needModel && PH ? fitProspectModel(H, PH, paramsFor(y0), y0) : null;
  if (model) writeFileSync(join(OUT, `model_${y0}${TAG ? `_${TAG}` : ""}.json`), JSON.stringify(model));
  for (const variant of VARIANTS) {
    for (const league of LEAGUES) {
      const t0 = Date.now();
      const rows = runYear(y0, variant, league, model);
      writeFileSync(join(OUT, `rows_${variant}${NOK && league === "captains" ? "-noK" : ""}${TAG ? `_${TAG}` : ""}_${league}_${y0}.json`), JSON.stringify(rows));
      console.log(`${y0} ${variant} ${league}: ${rows.length} rows (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    }
  }
}
