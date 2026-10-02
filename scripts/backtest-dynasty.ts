/**
 * Walk-forward backtest of the Captains dynasty model (src/lib/dynasty) against
 * simple baselines, as a reproducible control (audit 2026-10-02, MODEL-VS-BASELINE).
 *
 * As of Oct 1 of each start year Y0, every input uses only seasons < Y0: the
 * skater's history, a Marcel-style FP/G projection (3 seasons 5/4/3, regressed
 * 125 weighted games toward 0.9 × the position mean) and games share, his
 * draft slot and birth date; prospects are the draftees of Y0 − 6 … Y0 with
 * no NHL game before Y0. The realized value is the simulator's own season-gain
 * definition (league-1 scoring, 82-game scaled, no keeper cost) on what the
 * players actually did from Y0 to 2025-26, weighted by each mode's discount.
 *
 * Reports per start year (skaters with an NHL history):
 *  - Spearman of the model's DV, of bAge (Marcel × the aging curve, 12
 *    seasons) — the threshold the model must beat —, of bProj (one season)
 *    and of bLast (last season's FP) with the realized value;
 *  - a bootstrap 90 % interval of Spearman(model) − Spearman(bAge);
 *  - the top-50 capture (realized value of the model's 50 best / the best 50);
 *  - under-25 Spearman; calibration Σ model / Σ realized by route on the
 *    common horizon; the draft-slot prospects' calibration and rank quality.
 *
 * The history (MoneyPuck season totals 2008-09 … 2025-26, NHL draft classes,
 * bios) is not committed: pass it with --hist (built by the 2026-10-02 audit,
 * scratchpad audit2/cache/dynasty-hist-skaters-goalies-2008-2025.json).
 *
 * Run: npx tsx scripts/backtest-dynasty.ts --hist <file> [--years 2015,2017,2019,2021]
 *        [--paths 2000] [--noK] [--mode balanced|winNow|longTerm] [--out <dir>] [--tag x]
 *      PATCH='{"prospect":{"decay":[…]}}' merges into params.json first.
 */
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { buildDynasty } from "../src/lib/dynasty/index";
import { parseParams, type DynastyParams } from "../src/lib/dynasty/params";
import { seasonFpgLeague } from "../src/lib/dynasty/growth";
import { replacement } from "../src/lib/dynasty/scale";
import type { DynastyInput, SeasonLine } from "../src/lib/dynasty/types";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const HIST = arg("--hist") ?? process.env.DYNASTY_HIST;
if (!HIST) {
  console.error("backtest-dynasty: --hist <dynasty-hist-skaters-goalies-2008-2025.json> is required");
  process.exit(2);
}
const YEARS = (arg("--years") ?? "2015,2017,2019,2021").split(",").map(Number);
const PATHS = Number(arg("--paths") ?? 2000);
const NOK = args.includes("--noK");
const MODE = (arg("--mode") ?? "balanced") as "balanced" | "winNow" | "longTerm";
const OUT = arg("--out");
const TAG = arg("--tag") ?? "";
const LAST = 2025;
const SG: Record<number, number> = { 2012: 48, 2019: 70, 2020: 56 };
const sg = (y: number) => SG[y] ?? 82;

type Sk = { gp: number; g: number; a1: number; a2: number; s: number; h: number; b: number; tk: number; toi: number | null };
interface HistPlayer {
  n: string;
  pos: "F" | "D" | "G";
  birth?: string | null;
  draft?: { year: number; pick: number };
  sk: Record<string, Sk>;
}
interface Draftee {
  year: number;
  pick: number;
  pos: string;
  name: string;
  id: number | null;
  birth: string | null;
}
const H = JSON.parse(readFileSync(HIST, "utf8")) as { players: Record<string, HistPlayer>; draftees: Draftee[] };

function paramsFor(y0: number): DynastyParams {
  const raw = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8"));
  raw.firstSeasonYear = y0;
  raw.games.seasonGames = 82; // historical seasons: 82 games
  raw.market.enabled = false;
  if (process.env.PATCH) {
    const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
      for (const k of Object.keys(b)) {
        const bv = b[k];
        const av = a[k];
        if (bv && typeof bv === "object" && !Array.isArray(bv) && av && typeof av === "object") merge(av as Record<string, unknown>, bv as Record<string, unknown>);
        else a[k] = bv;
      }
    };
    merge(raw, JSON.parse(process.env.PATCH));
  }
  return parseParams(raw);
}

const ageOn = (birth: string | null | undefined, y: number) =>
  birth ? (Date.UTC(y, 9, 1) - Date.parse(`${birth}T00:00:00Z`)) / (365.25 * 86400000) : null;

// ---- statistics
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
function pearson(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const ma = a.reduce((s, x) => s + x, 0) / n;
  const mb = b.reduce((s, x) => s + x, 0) / n;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += (a[i]! - ma) * (b[i]! - mb);
    aa += (a[i]! - ma) ** 2;
    bb += (b[i]! - mb) ** 2;
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}
const spearman = (a: readonly number[], b: readonly number[]) => pearson(ranks(a), ranks(b));
function capture(pred: readonly number[], real: readonly number[], N: number): number {
  const ip = pred.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]).slice(0, N).map((x) => x[1]);
  const best = [...real].sort((a, b) => b - a).slice(0, N).reduce((s, x) => s + x, 0);
  return best > 0 ? ip.reduce((s, i) => s + real[i]!, 0) / best : 0;
}

interface Row {
  id: string;
  prospect: boolean;
  route: string;
  age: number | null;
  pick: number | null;
  mod: number;
  mT: number;
  real: number;
  bAge: number;
  bProj: number;
  bLast: number;
  /** Per season from Y0 (season gains realized; the model's expected gains), for the analyses. */
  gains: number[];
  eG: number[];
  draftYear: number | null;
  games: number[];
}

export interface YearSummary {
  y0: number;
  mode: string;
  n: number;
  spearman: { model: number; bAge: number; bProj: number; bLast: number; young: number; youngBAge: number };
  diffCI90: [number, number];
  capture50: { model: number; bAge: number };
  calibration: Record<string, number>;
  prospects: { n: number; calibration: number; spearman: number; spearmanPick: number };
}

function runYear(y0: number): YearSummary {
  const p = paramsFor(y0);
  const repl = replacement(p);
  const line = (y: number, s: Sk): SeasonLine => ({ season: y, gp: s.gp, toi: s.toi, goals: s.g, assists: s.a1 + s.a2, shots: s.s, hits: s.h, blocks: s.b, takeaways: s.tk });
  const fpgOf = (g: "F" | "D", y: number, s: Sk) => seasonFpgLeague(p, g, [line(y, s)])?.fpg ?? 0;
  const posMean: Record<string, number> = {};
  for (const y of [y0 - 1, y0 - 2, y0 - 3]) {
    for (const g of ["F", "D"] as const) {
      let a = 0;
      let n = 0;
      for (const pl of Object.values(H.players)) {
        const s = pl.sk[y];
        if (pl.pos !== g || !s || s.gp < 40) continue;
        a += fpgOf(g, y, s) * s.gp;
        n += s.gp;
      }
      posMean[`${g}${y}`] = a / n;
    }
  }
  const R_MARCEL = 125;
  const W = [5, 4, 3];
  const inputs: DynastyInput[] = [];
  const meta = new Map<string, { g: "F" | "D"; age: number | null; projFpg: number | null; projGp: number | null; lastFP: number; prospect: boolean; pick: number | null; draftYear: number | null }>();
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
    let den = 0;
    for (const [y, s] of recent) {
      const w = W[y0 - 1 - y]!;
      num += w * s.gp * fpgOf(g, y, s);
      den += w * s.gp;
    }
    const projFpg = (num + R_MARCEL * posMean[`${g}${y0 - 1}`]! * 0.9) / (den + R_MARCEL);
    const debut = past[0]![0];
    let sn = 0;
    let sd = 0;
    for (let k = 0; k < 3; k++) {
      const y = y0 - 1 - k;
      if (y < debut) continue;
      sn += W[k]! * Math.min(1, (pl.sk[y]?.gp ?? 0) / sg(y));
      sd += W[k]!;
    }
    const projGp = Math.round(82 * (0.8 * (sn / sd) + 0.2 * 0.75));
    const off = (projFpg - p.scale[g].a) / p.scale[g].b;
    const lastS = pl.sk[y0 - 1];
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
      ...(pl.draft ? { draft: pl.draft, draftSource: "profile" as const } : {}),
      eligNow: null,
      history: past.map(([y, s]) => line(y, s)),
      rostered: false,
    });
    meta.set(id, { g, age: ageOn(pl.birth, y0), projFpg, projGp, lastFP: lastS ? fpgOf(g, y0 - 1, lastS) * lastS.gp * (82 / sg(y0 - 1)) : 0, prospect: false, pick: pl.draft?.pick ?? null, draftYear: pl.draft?.year ?? null });
  }
  for (const d of H.draftees) {
    if (d.year < y0 - 6 || d.year > y0 || d.pos === "G") continue;
    const id = d.id != null ? String(d.id) : `dr${d.year}-${d.pick}`;
    if (meta.has(id)) continue;
    const pl = d.id != null ? H.players[String(d.id)] : undefined;
    if (pl && Object.keys(pl.sk).some((y) => Number(y) < y0)) continue;
    const g = d.pos === "D" ? "D" : "F";
    const birth = d.birth ?? pl?.birth ?? `${d.year - 18}-01-01`;
    inputs.push({ id, n: d.name, e: g === "D" ? "D,Skt" : "C,F,Skt", team: null, birthDate: birth, careerGp: 0, seasonGp: 0, draft: { year: d.year, pick: d.pick }, draftSource: "profile", eligNow: null, rostered: false });
    meta.set(id, { g, age: ageOn(birth, y0), projFpg: null, projGp: null, lastFP: 0, prospect: true, pick: d.pick, draftYear: d.year });
  }
  const res = buildDynasty(
    { players: inputs, meta: { valuesFetchedAt: "x", stateFetchedAt: "x", projectionsAt: "x", prospectsBuiltAt: "x" } },
    p,
    { paths: PATHS, market: false, ...(NOK ? { K: 0, Kgate: 0 } : {}) },
  );
  const m = p.modes[MODE];
  const w = (t: number) => (t === 0 ? m.w0 : t === 1 ? (m.w1 ?? 1) : 1) * Math.pow(m.delta, t);
  const Hn = LAST - y0 + 1;
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
  const rows: Row[] = [];
  for (const inp of inputs) {
    const rec = res.all[inp.id]!;
    const mt = meta.get(inp.id)!;
    const g = mt.g;
    const R = g === "D" ? repl.D : repl.F;
    const capt = (x: number) => (g === "F" ? 0.5 * Math.max(0, x - repl.offRef) : 0);
    const pl = H.players[inp.id];
    let real = 0;
    const gains = new Array<number>(LAST - y0 + 1).fill(0);
    const gamesBy = new Array<number>(LAST - y0 + 1).fill(0);
    for (let y = y0; y <= LAST; y++) {
      const s = pl?.sk[y];
      if (!s || !(s.gp > 0)) continue;
      const fpg = fpgOf(g, y, s);
      const games = s.gp * (82 / sg(y));
      gamesBy[y - y0] = Math.round(games);
      const gn = Math.max(0, (fpg - R) * games + capt(fpg) * games);
      gains[y - y0] = Math.round(gn * 10) / 10;
      real += w(y - y0) * gn;
    }
    let bAge = 0;
    if (mt.projFpg != null && mt.age != null)
      for (let t = 0; t < p.T && mt.age + t < 38; t++) {
        const x = (mt.projFpg * curve(g, mt.age + t)) / curve(g, mt.age);
        bAge += w(t) * Math.max(0, (x - R + capt(x)) * mt.projGp!);
      }
    rows.push({
      id: inp.id,
      prospect: mt.prospect,
      route: res.internals.get(inp.id)!.routed.route,
      age: mt.age,
      pick: mt.pick,
      mod: rec.dv[MODE],
      mT: rec.eG.slice(0, Hn).reduce((s, x, t) => s + w(t) * x, 0),
      real,
      bAge,
      bProj: mt.projFpg != null ? Math.max(0, (mt.projFpg - R + capt(mt.projFpg)) * mt.projGp!) : 0,
      bLast: mt.lastFP,
      gains,
      eG: rec.eG.slice(0, LAST - y0 + 1),
      draftYear: mt.draftYear,
      games: gamesBy,
    });
  }
  const nhl = rows.filter((r) => !r.prospect);
  const sp = (k: keyof Row, rs: readonly Row[] = nhl) => spearman(rs.map((r) => r[k] as number), rs.map((r) => r.real));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const ds: number[] = [];
  for (let b = 0; b < 300; b++) {
    const rr = nhl.map(() => nhl[Math.floor(rnd() * nhl.length)]!);
    ds.push(sp("mod", rr) - sp("bAge", rr));
  }
  ds.sort((a, b) => a - b);
  const young = nhl.filter((r) => r.age != null && r.age < 25);
  const cal: Record<string, [number, number]> = {};
  for (const r of nhl) {
    const k = r.route + (r.route === "nhl-part" ? ((r.age ?? 30) < 23 ? "<23" : "23+") : "");
    cal[k] ??= [0, 0];
    cal[k][0] += r.mT;
    cal[k][1] += r.real;
  }
  const pros = rows.filter((r) => r.prospect);
  const pm = pros.reduce((a, r) => a + r.mT, 0);
  const pr = pros.reduce((a, r) => a + r.real, 0);
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const out: YearSummary = {
    y0,
    mode: MODE,
    n: nhl.length,
    spearman: { model: r3(sp("mod")), bAge: r3(sp("bAge")), bProj: r3(sp("bProj")), bLast: r3(sp("bLast")), young: r3(sp("mod", young)), youngBAge: r3(sp("bAge", young)) },
    diffCI90: [r3(ds[15]!), r3(ds[284]!)],
    capture50: { model: r3(capture(nhl.map((r) => r.mod), nhl.map((r) => r.real), 50)), bAge: r3(capture(nhl.map((r) => r.bAge), nhl.map((r) => r.real), 50)) },
    calibration: Object.fromEntries(Object.entries(cal).map(([k, [a, b]]) => [k, r3(b > 0 ? a / b : 0)])),
    prospects: {
      n: pros.length,
      calibration: r3(pr > 0 ? pm / pr : 0),
      spearman: r3(sp("mod", pros)),
      spearmanPick: r3(spearman(pros.map((r) => -(r.pick ?? 999)), pros.map((r) => r.real))),
    },
  };
  if (OUT) {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(join(OUT, `bt_${y0}${NOK ? "_noK" : ""}${TAG ? `_${TAG}` : ""}.json`), JSON.stringify({ summary: out, rows }));
  }
  return out;
}

const all: YearSummary[] = [];
for (const y of YEARS) {
  const t0 = Date.now();
  const s = runYear(y);
  all.push(s);
  console.log(
    `${y} ${MODE}${NOK ? " noK" : ""} n=${s.n} (${((Date.now() - t0) / 1000).toFixed(0)} s): Spearman model ${s.spearman.model} bAge ${s.spearman.bAge} bProj ${s.spearman.bProj} bLast ${s.spearman.bLast} | model−bAge 90% [${s.diffCI90.join(", ")}] | top-50 capture ${s.capture50.model} vs ${s.capture50.bAge} | <25 ${s.spearman.young} vs ${s.spearman.youngBAge}`,
  );
  console.log(`     calibration ${JSON.stringify(s.calibration)} | slot prospects n=${s.prospects.n} cal ${s.prospects.calibration} Spearman ${s.prospects.spearman} (draft order ${s.prospects.spearmanPick})`);
}
const mean = (f: (s: YearSummary) => number) => Math.round((all.reduce((a, s) => a + f(s), 0) / all.length) * 1000) / 1000;
console.log(`mean: model ${mean((s) => s.spearman.model)} bAge ${mean((s) => s.spearman.bAge)} | <25 ${mean((s) => s.spearman.young)} | capture ${mean((s) => s.capture50.model)} vs ${mean((s) => s.capture50.bAge)}`);
