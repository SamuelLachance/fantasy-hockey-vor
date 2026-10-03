/**
 * Scorecard of the dynasty walk-forward backtest (rows written by
 * scripts/dynasty-backtest.ts): for each league and horizon H (3 and 5
 * seasons), the predictions of every variant and baseline against the
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
 * pick (draft order, prospects).
 *
 * Also scored (reported, not shipped): ens = 0.6 × <last variant>.eG + 0.4 × bAge,
 * the blend the walk-forward weight search settled near (it gains < 0.01
 * Spearman in Slapshot and trades Spearman for top-N precision in Captains).
 *
 * --record <prospect-model.json>: writes the nhle-vs-reference deltas that
 * justify the shipped prospect model into its `backtest` field (`gate`: the
 * cells scripts/test-dynasty-nhle.ts requires to stay positive).
 *
 * Run: npx tsx scripts/dynasty-scorecard.ts --dir <rows dir> [--variants base,nhle]
 *        [--leagues captains,slapshot] [--years …] [--json out.json] [--ref base]
 *        [--record src/data/dynasty/prospect-model.json]
 */
import { readFileSync, readdirSync, writeFileSync } from "fs";
import { join } from "path";
import { LAST_SEASON, calSlope, capture, lcg, q, spearman, topNPrecision } from "./dynasty-backtest-lib";
import type { BtRow } from "./dynasty-backtest";

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
  /** The board's head: the union of the top 300 by realized value, by the reference variant and by bAge (one set for every predictor). */
  head: () => true,
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
  for (const H of [3, 5]) {
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
    const headOf = (js: Joined[]) => {
      const keep = new Set<Joined>();
      for (const f of [real, preds[`${REF}.eG`]!, preds.bAge!]) [...js].sort((a, b) => f(b) - f(a)).slice(0, 300).forEach((j) => keep.add(j));
      return js.filter((j) => keep.has(j));
    };
    for (const [gname, gf] of Object.entries(GROUPS)) {
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
        const js = gname === "head" ? headOf(js0) : js0.filter((j) => gf(j.base));
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
      console.log(`\n=== ${league} H=${H} ${gname} (years ${[...data.keys()].join(",")}, n≈${Math.round([...data.values()].reduce((a, js) => a + (gname === "head" ? headOf(js) : js.filter((j) => gf(j.base))).length, 0) / data.size)})`);
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
const J = arg("--json");
if (J) writeFileSync(J, JSON.stringify(out, null, 1));

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
    // the gate: the prospect and board-head rank gains, whose 90 % interval excludes 0 in the recorded run
    if (g === "prospects" || g === "head" || g === "young") {
      const d = v.res[NEW]?.spearman?.dRef;
      if (d) gate[`${league}.${h}.${g}.spearman`] = d.mean;
    }
  }
  const model = JSON.parse(readFileSync(REC, "utf8")) as Record<string, unknown>;
  model.backtest = {
    script: "scripts/dynasty-backtest.ts + scripts/dynasty-scorecard.ts --record",
    recordedAt: new Date().toISOString().slice(0, 10),
    ref: `${REF}.eG`,
    new: NEW,
    years: YEARS,
    note: "Walk-forward: at each start year the NHLe model is refitted on classes whose 7-season outcome was complete before it; Σ E[G_t] vs realized season gains in each league's scoring over 3 and 5 seasons. d = new − ref (mean over start years), ci = 90 % paired bootstrap.",
    gate,
    cells,
  };
  writeFileSync(REC, JSON.stringify(model, null, 1) + "\n");
  console.log(`recorded backtest in ${REC} (${Object.keys(gate).length} gate cells)`);
}
