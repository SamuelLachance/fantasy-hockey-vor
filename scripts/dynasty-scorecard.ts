/**
 * Scorecard of the dynasty walk-forward backtest (rows written by
 * scripts/dynasty-backtest.ts): for each league and horizon H (3 and 5
 * seasons by default, --horizons), the predictions of every variant and baseline against the
 * realized value over seasons Y0 … Y0 + H − 1 (season gains in the league's
 * scoring, undiscounted), pooled over the start years that have the full
 * horizon.
 *
 * Metrics (per start year, then averaged over years): Spearman, top-N
 * precision (N = 50 / 160 overall, 25 among prospects), capture of the
 * top 50, calibration (Σ predicted / Σ realized; OLS slope of realized on
 * predicted). 90 % intervals: paired bootstrap of players within each year
 * (400 replicates), the replicate means over years.
 *
 * Predictors: <variant>.eG (Σ E[G_t], t < H), <variant>.dv (balanced DV),
 * bAge (Marcel × aging curve), bProj (Marcel flat), bLast (last season),
 * pick (draft order, prospects). Variant « base » is the engine at bd259b2
 * with its prospects on the draft-slot route (fallback): the live board's
 * earlier research records (an NHLe model fitted on every class, a scouting
 * tier shift from 2026 opinions) cannot be rebuilt at past dates, so they
 * were never scored walk-forward.
 *
 * Groups: all, nhl (not a prospect), prospects, young (prospects and under
 * 25), head (the board's head: the union of the top 300 by realized value
 * and by EVERY predictor scored, so no predictor's false positives are
 * dropped while another's are counted), headReal (the top 300 by realized
 * value only).
 *
 * Prospects in the long-term top 200 (scripts/../src/lib/dynasty/checks.ts
 * GATES.top200ProspectsLongTerm): for start years with six realized seasons,
 * the players on the prospect route at Y0 (« slot » in the base variant) among the top 200 by the
 * long-term mode weights (params.json modes.longTerm) over t = 0 … 5, of the
 * realized gains and of each variant's E[G_t].
 *
 * Also scored (reported, not shipped): ens = 0.6 × <last variant>.eG + 0.4 × bAge,
 * the blend the walk-forward weight search settled near (it gains < 0.01
 * Spearman in Slapshot and trades Spearman for top-N precision in Captains).
 *
 * Design choices of the NHLe model (design terms, NHLE_SHRINK, CHAIN_VIA,
 * league-factor pseudo pairs 30, ridge 2) were tuned on start years
 * 2015-2023. Start year 2024 was never scored during design: check it with
 * --years 2024 --horizons 2 (the only horizon complete), against
 * --years 2015,…,2023 --horizons 2.
 *
 * --record <prospect-model.json>: writes the nhle-vs-reference deltas that
 * justify the shipped prospect model into its `backtest` field (`gate`: the
 * cells scripts/test-dynasty-nhle.ts requires to stay positive).
 *
 * Run: npx tsx scripts/dynasty-scorecard.ts --dir <rows dir> [--variants base,nhle]
 *        [--leagues captains,slapshot] [--years …] [--horizons 3,5] [--json out.json] [--ref base]
 *        [--record src/data/dynasty/prospect-model.json]
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { LAST_SEASON, calSlope, capture, lcg, q, spearman, topNPrecision } from "./dynasty-backtest-lib";
import type { BtRow } from "./dynasty-backtest";
import { procedureHash } from "./dynasty-model-hash";
import { parseParams } from "../src/lib/dynasty/params";
import { discount, modeWeights } from "../src/lib/dynasty/value";

const args = process.argv.slice(2);
const arg = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const DIR = arg("--dir");
if (!DIR) {
  console.error("dynasty-scorecard: --dir <rows dir> is required");
  process.exit(2);
}
const VARIANTS = (arg("--variants") ?? "base,nhle").split(",");
const LEAGUES = (arg("--leagues") ?? "captains,slapshot").split(",");
const REF = arg("--ref") ?? VARIANTS[0]!;
const B = Number(arg("--boot") ?? 400);
const files = readdirSync(DIR);
const yearsAll = [...new Set(files.map((f) => /_(\d{4})\.json$/.exec(f)?.[1]).filter(Boolean).map(Number))].sort();
const YEARS = arg("--years") ? arg("--years")!.split(",").map(Number) : yearsAll;
const HORIZONS = (arg("--horizons") ?? "3,5").split(",").map(Number);

const sumT = (xs: readonly number[], H: number) => xs.slice(0, H).reduce((a, x) => a + x, 0);

interface Joined {
  base: BtRow;
  by: Record<string, BtRow>;
}

function load(variant: string, league: string, y0: number): BtRow[] | null {
  const f = `rows_${variant}_${league}_${y0}.json`;
  if (!files.includes(f)) return null;
  return JSON.parse(readFileSync(join(DIR!, f), "utf8")) as BtRow[];
}

const GROUPS: Record<string, (r: BtRow) => boolean> = {
  all: () => true,
  nhl: (r) => !r.prospect,
  prospects: (r) => r.prospect,
  young: (r) => r.prospect || (r.age != null && r.age < 25),
  /** The board's head: the union of the top 300 by realized value and by every predictor scored (symmetric: one set for every predictor). */
  head: () => true,
  /** The top 300 by realized value only (ex post; no predictor picks the set). */
  headReal: () => true,
};

interface Metric {
  name: string;
  f: (pred: number[], real: number[]) => number;
}
const METRICS: Metric[] = [
  { name: "spearman", f: spearman },
  { name: "top50", f: (a, b) => topNPrecision(a, b, 50) },
  { name: "top160", f: (a, b) => topNPrecision(a, b, 160) },
  { name: "capture50", f: (a, b) => capture(a, b, 50) },
  { name: "calRatio", f: (a, b) => b.reduce((s, x) => s + x, 0) > 0 ? a.reduce((s, x) => s + x, 0) / b.reduce((s, x) => s + x, 0) : 0 },
  { name: "calSlope", f: calSlope },
];
const PROSPECT_METRICS: Metric[] = [
  { name: "spearman", f: spearman },
  { name: "top25", f: (a, b) => topNPrecision(a, b, 25) },
  { name: "capture25", f: (a, b) => capture(a, b, 25) },
  { name: "calRatio", f: METRICS[4]!.f },
];

const out: Record<string, unknown> = {};
const r3 = (x: number) => Math.round(x * 1000) / 1000;
for (const league of LEAGUES) {
  for (const H of HORIZONS) {
    const years = YEARS.filter((y) => y + H - 1 <= LAST_SEASON);
    const data = new Map<number, Joined[]>();
    for (const y of years) {
      const per: Record<string, Map<string, BtRow>> = {};
      let ok = true;
      for (const v of VARIANTS) {
        const rs = load(v, league, y);
        if (!rs) {
          ok = false;
          break;
        }
        per[v] = new Map(rs.map((r) => [r.id, r]));
      }
      if (!ok) continue;
      const ids = [...per[VARIANTS[0]!]!.keys()].filter((id) => VARIANTS.every((v) => per[v]!.has(id)));
      data.set(
        y,
        ids.map((id) => ({ base: per[VARIANTS[0]!]!.get(id)!, by: Object.fromEntries(VARIANTS.map((v) => [v, per[v]!.get(id)!])) })),
      );
    }
    if (!data.size) continue;
    const preds: Record<string, (j: Joined) => number> = {};
    for (const v of VARIANTS) {
      preds[`${v}.eG`] = (j) => sumT(j.by[v]!.eG, H);
      preds[`${v}.dv`] = (j) => j.by[v]!.dv;
    }
    preds.bAge = (j) => sumT(j.base.bAge, H);
    const LASTV = VARIANTS[VARIANTS.length - 1]!;
    preds.ens = (j) => 0.6 * sumT(j.by[LASTV]!.eG, H) + 0.4 * sumT(j.base.bAge, H);
    preds.bProj = (j) => j.base.bProj * H;
    preds.bLast = (j) => j.base.bLast * H;
    preds.pick = (j) => (j.base.pick != null ? -j.base.pick : -999);
    const real = (j: Joined) => sumT(j.base.real, H);
    const headPreds = Object.keys(preds).filter((k) => k !== "pick").map((k) => preds[k]!);
    const topSet = (js: Joined[], fs: Array<(j: Joined) => number>) => {
      const keep = new Set<Joined>();
      for (const f of fs) [...js].sort((a, b) => f(b) - f(a)).slice(0, 300).forEach((j) => keep.add(j));
      return js.filter((j) => keep.has(j));
    };
    const select = (gname: string, js: Joined[]) =>
      gname === "head" ? topSet(js, [real, ...headPreds]) : gname === "headReal" ? topSet(js, [real]) : js.filter((j) => GROUPS[gname]!(j.base));
    for (const gname of Object.keys(GROUPS)) {
      const mets = gname === "prospects" ? PROSPECT_METRICS : METRICS;
      const predNames = Object.keys(preds).filter((k) => (gname === "prospects" ? !["bAge", "bProj", "bLast", "ens"].includes(k) : k !== "pick"));
      const res: Record<string, Record<string, { mean: number; ci?: [number, number]; dRef?: { mean: number; ci: [number, number] } }>> = {};
      // per-year point estimates and bootstrap replicates
      const reps: Record<string, Record<string, number[][]>> = {};
      const point: Record<string, Record<string, number[]>> = {};
      for (const pn of predNames) {
        reps[pn] = {};
        point[pn] = {};
        for (const m of mets) {
          reps[pn]![m.name] = [];
          point[pn]![m.name] = [];
        }
      }
      for (const [y, js0] of data) {
        const js = select(gname, js0);
        if (js.length < 20) continue;
        const rv = js.map(real);
        const pv: Record<string, number[]> = {};
        for (const pn of predNames) pv[pn] = js.map(preds[pn]!);
        for (const pn of predNames) for (const m of mets) point[pn]![m.name]!.push(m.f(pv[pn]!, rv));
        const rnd = lcg(1000 + y);
        for (let b = 0; b < B; b++) {
          const ix = js.map(() => Math.floor(rnd() * js.length));
          const rr = ix.map((i) => rv[i]!);
          for (const pn of predNames) {
            const pp = ix.map((i) => pv[pn]![i]!);
            for (const m of mets) {
              const arr = reps[pn]![m.name]!;
              (arr[b] ??= []).push(m.f(pp, rr));
            }
          }
        }
      }
      for (const pn of predNames) {
        res[pn] = {};
        for (const m of mets) {
          const pts = point[pn]![m.name]!;
          if (!pts.length) continue;
          const mean = pts.reduce((a, x) => a + x, 0) / pts.length;
          const bm = reps[pn]![m.name]!.map((ys) => ys.reduce((a, x) => a + x, 0) / ys.length);
          const refName = `${REF}.eG`;
          const entry: { mean: number; ci?: [number, number]; dRef?: { mean: number; ci: [number, number] } } = { mean: r3(mean), ci: [r3(q(bm, 0.05)), r3(q(bm, 0.95))] };
          if (pn !== refName && reps[refName]) {
            const refPts = point[refName]![m.name]!;
            const d = pts.map((x, i) => x - refPts[i]!);
            const bd = reps[pn]![m.name]!.map((ys, b) => ys.reduce((a, x, i) => a + x - reps[refName]![m.name]![b]![i]!, 0) / ys.length);
            entry.dRef = { mean: r3(d.reduce((a, x) => a + x, 0) / d.length), ci: [r3(q(bd, 0.05)), r3(q(bd, 0.95))] };
          }
          res[pn]![m.name] = entry;
        }
      }
      out[`${league}|H${H}|${gname}`] = { years: [...data.keys()], res };
      // print
      console.log(`\n=== ${league} H=${H} ${gname} (years ${[...data.keys()].join(",")}, n≈${Math.round([...data.values()].reduce((a, js) => a + select(gname, js).length, 0) / data.size)})`);
      console.log(["pred".padEnd(14), ...mets.map((m) => m.name.padStart(24))].join(""));
      for (const pn of predNames) {
        const cells = mets.map((m) => {
          const e = res[pn]![m.name];
          if (!e) return "".padStart(24);
          const d = e.dRef ? ` Δ${e.dRef.mean >= 0 ? "+" : ""}${e.dRef.mean.toFixed(3)}[${e.dRef.ci[0].toFixed(3)},${e.dRef.ci[1].toFixed(3)}]` : "";
          return `${e.mean.toFixed(3)}${d}`.padStart(24);
        });
        console.log([pn.padEnd(14), ...cells].join(""));
      }
    }
  }
}
// ---- prospects (route at Y0) in the long-term top 200, six realized seasons
const LT = modeWeights(parseParams(JSON.parse(readFileSync(join(process.cwd(), "src", "data", "dynasty", "params.json"), "utf8")))).longTerm;
const top200: Record<string, { years: number[]; realized: number[]; by: Record<string, number[]> }> = {};
for (const league of LEAGUES) {
  const yrs = YEARS.filter((y) => y + 5 <= LAST_SEASON);
  const e = { years: [] as number[], realized: [] as number[], by: Object.fromEntries(VARIANTS.map((v) => [v, [] as number[]])) };
  for (const y of yrs) {
    const per = VARIANTS.map((v) => load(v, league, y));
    if (per.some((r) => !r)) continue;
    const count = (rs: BtRow[], f: (r: BtRow) => number) =>
      [...rs]
        .sort((a, b) => f(b) - f(a))
        .slice(0, 200)
        .filter((r) => r.route === "prospect" || r.route === "slot").length;
    e.years.push(y);
    // realized: the reference rows' route (the same players; the route at Y0 is the variant's own)
    e.realized.push(count(per[per.length - 1]!, (r) => discount(r.real.slice(0, 6), LT)));
    VARIANTS.forEach((v, i) => e.by[v]!.push(count(per[i]!, (r) => discount(r.eG.slice(0, 6), LT))));
  }
  if (!e.years.length) continue;
  top200[league] = e;
  console.log(`\n=== ${league}: prospects (route at Y0) in the long-term top 200, years ${e.years.join(",")}`);
  console.log(`realized ${e.realized.join(" ")}  [${Math.min(...e.realized)}, ${Math.max(...e.realized)}]`);
  for (const v of VARIANTS) console.log(`${v.padEnd(8)} ${e.by[v]!.join(" ")}  [${Math.min(...e.by[v]!)}, ${Math.max(...e.by[v]!)}]`);
}

const J = arg("--json");
if (J) writeFileSync(J, JSON.stringify({ cells: out, top200 }, null, 1));

const REC = arg("--record");
if (REC) {
  type Cell = { years: number[]; res: Record<string, Record<string, { mean: number; ci?: [number, number]; dRef?: { mean: number; ci: [number, number] } }>> };
  const NEW = `${VARIANTS[VARIANTS.length - 1]}.eG`;
  const cells: Record<string, unknown> = {};
  const gate: Record<string, number> = {};
  for (const [k, v] of Object.entries(out as Record<string, Cell>)) {
    const [league, h, g] = k.split("|");
    const mets = g === "prospects" ? ["spearman", "top25", "capture25"] : ["spearman", "top50", "top160"];
    for (const m of mets) {
      const e = v.res[NEW]?.[m];
      const ref = v.res[`${REF}.eG`]?.[m];
      const bAge = v.res.bAge?.[m];
      if (!e || !ref) continue;
      cells[`${league}.${h}.${g}.${m}`] = { ref: ref.mean, new: e.mean, d: e.dRef?.mean, ci: e.dRef?.ci, ...(bAge ? { bAge: bAge.mean } : {}) };
    }
    // the gate: the rank gains over the reference whose 90 % interval excludes 0 in the recorded run
    if (g === "prospects" || g === "head" || g === "young") {
      const d = v.res[NEW]?.spearman?.dRef;
      if (d && d.ci[0] > 0) gate[`${league}.${h}.${g}.spearman`] = d.mean;
    }
  }
  const model = JSON.parse(readFileSync(REC, "utf8")) as Record<string, unknown>;
  model.backtest = {
    script: "scripts/dynasty-backtest.ts + scripts/dynasty-scorecard.ts --record",
    recordedAt: new Date().toLocaleDateString("en-CA"), // local date (YYYY-MM-DD)
    procedureHash: procedureHash(),
    ref: `${REF}.eG`,
    refLabel: "route rang de repêchage (fallback) : le moteur de bd259b2 avec ses espoirs sur la route du rang de repêchage. Les fiches de recherche du tableau en ligne à bd259b2 (NHLe ajusté sur toutes les cohortes, décalage par palier de dépisteur selon des opinions de 2026) ne se reconstruisent pas à une date passée et n'ont jamais été évaluées walk-forward.",
    new: NEW,
    years: YEARS,
    horizons: HORIZONS,
    note: "Walk-forward: at each start year the NHLe model is refitted on classes whose 7-season outcome was complete before it; Σ E[G_t] vs realized season gains in each league's scoring. d = new − ref (mean over start years), ci = 90 % paired bootstrap of players within each year. head = union of the top 300 by realized value and by every predictor scored (symmetric); headReal = top 300 by realized value. The gate keeps the Spearman gains whose interval excludes 0.",
    gate,
    top200,
    cells,
  };
  writeFileSync(REC, JSON.stringify(model, null, 1) + "\n");
  console.log(`recorded backtest in ${REC} (${Object.keys(gate).length} gate cells)`);
}
