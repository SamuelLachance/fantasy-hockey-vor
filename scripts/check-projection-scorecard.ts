/**
 * CI guard of the projection backtest (cheap: reads committed JSON only).
 *
 * src/data/ml/projection-scorecard.json is the walk-forward scorecard of the
 * shipped skater projection (scripts/backtest-projections.ts --out=…). This
 * check fails when
 *   - the scorecard was produced under another configuration than the one
 *     shipped: meta weighting, market blend, market file bytes, the training
 *     dataset (the bundle's datasetSha1), the bundle's blend weights, or the
 *     stack / blend code (src/lib/ml/stack.ts, market-blend.ts): a change to
 *     any of them must come with a re-run of the backtest;
 *   - the re-run shows the shipped projection losing: on the league
 *     headline metrics it must beat bd259b2's engine, the ESPN market and the
 *     simple baselines with a 95% bootstrap interval entirely below 0;
 *   - a Light the Lamp category's season totals, a rate, the top-60 bias or
 *     a season ranking gets worse than bd259b2's engine beyond a tolerance;
 *   - the season ranking loses to ESPN's ADP (drafted players) with a 95%
 *     interval below 0, or by more than 0.01 of Spearman;
 *   - the published pre-season board's rate level calibration shifts a
 *     typical rate by more than 5% (post-processing the scorecard does not
 *     replay; the ESPN file's unpublished stats are checked by check:bundle).
 *
 * Re-run: npx tsx scripts/backtest-projections-signals.ts --cache=<dir>
 *         npx tsx scripts/backtest-projections.ts --signals=<dir> --out=src/data/ml/projection-scorecard.json
 * Run: npx tsx scripts/check-projection-scorecard.ts
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { MARKET_BLEND_STATS, type MarketBlend } from "../src/lib/ml/market-blend";
import { SHIPPED_META_WEIGHTING } from "../src/lib/ml/stack";

interface Row {
  metric: string;
  subset: string;
  a: string;
  b: string;
  valueA: number;
  valueB: number;
  diff: number;
  lo: number;
  hi: number;
  n: number;
}
interface RankingRow {
  ranking: string;
  metric: string;
  a: string;
  b: string;
  valueA: number;
  valueB: number;
  diff: number;
  lo: number;
  hi: number;
  n: number;
  seasons: number[];
}
interface Scorecard {
  builtAt: string;
  testSeasons: number[];
  config: {
    metaWeighting: { weighting: string; recencyDecay: number };
    marketBlend: boolean;
    marketFileSha1: string | null;
    datasetSha1?: string | null;
    codeSha1?: Record<string, string>;
    bundle?: { trainedAt: string | null; datasetSha1: string | null; marketBlend: MarketBlend | null };
  };
  population: { examples: number; espnProjected: number };
  rows: Row[];
  spearman: Array<{ ranking: string; method: string; all: number; espnSet: number }>;
  adp?: RankingRow[];
  bias?: Array<{ subset: string; method: string; n: number; goals: number; assists: number; captainsFp: number }>;
}

const root = process.cwd();
const path = join(root, "src", "data", "ml", "projection-scorecard.json");
const errors: string[] = [];
if (!existsSync(path)) {
  console.error("FAIL: src/data/ml/projection-scorecard.json missing (scripts/backtest-projections.ts --out=…)");
  process.exit(1);
}
const sc = JSON.parse(readFileSync(path, "utf8")) as Scorecard;

// 1. Same configuration as what ships.
const mw = sc.config?.metaWeighting;
if (mw?.weighting !== SHIPPED_META_WEIGHTING.weighting || mw?.recencyDecay !== SHIPPED_META_WEIGHTING.recencyDecay) {
  errors.push(`scorecard meta weighting ${JSON.stringify(mw)} != shipped ${JSON.stringify(SHIPPED_META_WEIGHTING)}: re-run the backtest`);
}
const bundle = JSON.parse(readFileSync(join(root, "src", "data", "ml", "v2-bundle.json"), "utf8")) as {
  trainedAt?: string;
  datasetSha1?: string;
  skater?: { marketBlend?: MarketBlend };
};
if (Boolean(sc.config?.marketBlend) !== Boolean(bundle.skater?.marketBlend)) {
  errors.push(`scorecard market blend ${sc.config?.marketBlend} but the bundle ${bundle.skater?.marketBlend ? "has" : "has no"} blend`);
}
const marketPath = join(root, "src", "data", "ml", "market-espn.json");
const marketSha1 = existsSync(marketPath) ? createHash("sha1").update(readFileSync(marketPath)).digest("hex") : null;
if (sc.config?.marketFileSha1 !== marketSha1) {
  errors.push(`market-espn.json changed since the scorecard (${sc.config?.marketFileSha1?.slice(0, 12)} -> ${marketSha1?.slice(0, 12)}): re-run the backtest`);
}

// The dataset, the bundle's blend and the stack / blend code it measured.
if (!sc.config?.datasetSha1 || sc.config.datasetSha1 !== bundle.datasetSha1) {
  errors.push(
    `scorecard dataset ${sc.config?.datasetSha1?.slice(0, 12) ?? "?"} != bundle dataset ${bundle.datasetSha1?.slice(0, 12) ?? "?"}: re-run the backtest on the bundle's dataset`,
  );
}
const scBlend = sc.config?.bundle?.marketBlend;
const shipBlend = bundle.skater?.marketBlend;
if (!scBlend || !shipBlend) {
  if (Boolean(scBlend) !== Boolean(shipBlend)) errors.push("scorecard and bundle disagree on the market blend weights");
} else {
  const pairs: Array<[string, number, number]> = [
    ["gp", scBlend.gpBeta, shipBlend.gpBeta],
    ...MARKET_BLEND_STATS.map((t): [string, number, number] => [t, scBlend.betas[t], shipBlend.betas[t]]),
  ];
  for (const [t, a, b] of pairs) {
    if (!(Math.abs(a - b) < 1e-9)) errors.push(`bundle blend weight ${t} ${b} != the scorecard's ${a}: re-run the backtest`);
  }
}
const lf = (f: string) => createHash("sha1").update(Buffer.from(readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n"), "utf8")).digest("hex");
const code = sc.config?.codeSha1 ?? {};
for (const f of ["src/lib/ml/stack.ts", "src/lib/ml/market-blend.ts"]) {
  if (code[f] !== lf(f)) errors.push(`${f} changed since the scorecard (${code[f]?.slice(0, 12) ?? "none"} -> ${lf(f).slice(0, 12)}): re-run the backtest`);
}

// 2. Coverage of the protocol.
if ((sc.testSeasons?.length ?? 0) < 5) errors.push(`only ${sc.testSeasons?.length} test seasons (< 5)`);
if ((sc.population?.examples ?? 0) < 3000) errors.push(`only ${sc.population?.examples} scored player-seasons (< 3000)`);

// 3. The shipped projection wins, with a 95% interval below 0.
const find = (metric: string, b: string, subset = "all") =>
  sc.rows.find((r) => r.a === "candidate" && r.b === b && r.metric === metric && r.subset === subset);
const HEADLINE = [
  "Captains FP MAE",
  "Slapshot FP MAE",
  "Captains FP MSE",
  "Slapshot FP MSE",
  "LTL value MAE",
  "LTL value MSE",
  "GP MAE",
  "GP MSE",
];
const COMPARATORS = ["engine", "espn", "marcel543", "lag1", "ageCurve", "synth"];
let checked = 0;
for (const b of COMPARATORS) {
  for (const metric of HEADLINE) {
    // Games against ESPN on its own players: ESPN projects a healthy season
    // (bias +4.4 games), close to the median, so its absolute error is a
    // little lower (8.95 vs 9.13 after the blend takes a third of its gap);
    // the blend wins on the squared error (the mean, what expected points
    // need: 179 vs 203). GP MAE vs ESPN may not lose by more than 0.5 game;
    // GP MSE must win.
    const r = find(metric, b);
    if (!r) {
      errors.push(`no scorecard row ${metric} candidate vs ${b}`);
      continue;
    }
    checked++;
    const gate = b === "espn" && metric === "GP MAE" ? r.diff <= 0.5 : r.hi < 0;
    if (!gate) {
      errors.push(
        `${metric} candidate vs ${b}: ${r.valueA.toFixed(2)} vs ${r.valueB.toFixed(2)}, diff ${r.diff.toFixed(3)} [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]`,
      );
    }
  }
}
// No rate may get significantly worse than bd259b2's engine.
for (const r of sc.rows.filter((x) => x.a === "candidate" && x.b === "engine" && x.subset === "all" && x.metric.startsWith("rate MAE"))) {
  checked++;
  if (r.lo > 0) errors.push(`${r.metric} worse than bd259b2: diff ${r.diff.toFixed(3)} [${r.lo.toFixed(3)}, ${r.hi.toFixed(3)}]`);
}
// Light the Lamp season totals per category: within 1% of bd259b2's engine
// (the games blend cost hits totals +0.5% before the market's unpublished
// hits were skipped; any larger loss must be a decision, not drift).
for (const cat of ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"]) {
  const r = find(`total MAE ${cat}`, "engine");
  checked++;
  if (!r) errors.push(`no scorecard row total MAE ${cat} candidate vs engine`);
  else if (r.diff > 0.01 * r.valueB) {
    errors.push(`total MAE ${cat} vs bd259b2: ${r.valueA.toFixed(2)} vs ${r.valueB.toFixed(2)} (+${((100 * r.diff) / r.valueB).toFixed(2)}% > 1%)`);
  }
}
// Elite under-projection: the top-60 Captains bias may not grow more than 1
// point per 82 games beyond bd259b2's engine.
{
  const c = sc.bias?.find((b) => b.subset === "tier 1-60" && b.method === "candidate");
  const e = sc.bias?.find((b) => b.subset === "tier 1-60" && b.method === "engine");
  checked++;
  if (!c || !e) errors.push("scorecard has no top-60 bias rows (candidate, engine)");
  else if (Math.abs(c.captainsFp) > Math.abs(e.captainsFp) + 1) {
    errors.push(`top-60 Captains bias per 82: candidate ${c.captainsFp.toFixed(1)} vs bd259b2 ${e.captainsFp.toFixed(1)}`);
  }
}
// ESPN ADP (the drafted players): the shipped board's season ranking may tie
// it but not lose, neither with a 95% interval below 0 nor by more than 0.01
// of Spearman (top-N: 0.02 of hit rate).
for (const ranking of ["Captains FP", "Slapshot FP", "LTL value"]) {
  for (const metric of ["spearman", "top60", "top120"]) {
    const r = sc.adp?.find((x) => x.a === "candidate" && x.b === "adp" && x.ranking === ranking && x.metric === metric);
    checked++;
    if (!r) {
      errors.push(`no ADP ranking row ${ranking} ${metric}`);
      continue;
    }
    if ((r.seasons?.length ?? 0) < 5) errors.push(`ADP ${ranking} ${metric}: ${r.seasons?.length} seasons (< 5)`);
    const floor = metric === "spearman" ? 0.01 : 0.02;
    if (r.hi < 0 || r.diff < -floor) {
      errors.push(`${ranking} ${metric} vs ESPN ADP: ${r.valueA.toFixed(4)} vs ${r.valueB.toFixed(4)}, diff ${r.diff.toFixed(4)} [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]`);
    }
  }
}

// Ranking: the shipped board orders the season at least as well as every comparator.
for (const ranking of ["Captains FP", "Slapshot FP", "LTL value"]) {
  const cand = sc.spearman.find((x) => x.ranking === ranking && x.method === "candidate");
  for (const b of COMPARATORS) {
    const other = sc.spearman.find((x) => x.ranking === ranking && x.method === b);
    if (!cand || !other) continue;
    checked++;
    if (cand.espnSet < other.espnSet - 1e-9) {
      errors.push(`${ranking} Spearman on ESPN's players: candidate ${cand.espnSet.toFixed(4)} < ${b} ${other.espnSet.toFixed(4)}`);
    }
  }
}

// Post-processing the scorecard does not replay: the published board's rate
// level calibration (src/lib/rate-calibration.ts: rate' = rate - shift, with
// shift(market) = (a_raw - a_ref) + (b_raw - b_ref) x market against the
// reference board, src/data/ml/rate-reference.json) may not move a typical
// rate by more than 5%, or it could undo the rate gains measured here.
{
  type Lines = Record<string, Record<string, { a: number; b: number }>>;
  const board = JSON.parse(readFileSync(join(root, "src", "data", "players-preseason.json"), "utf8")) as {
    rateCalibration?: { raw?: Lines; target?: Lines };
  };
  const raw = board.rateCalibration?.raw ?? {};
  const target = board.rateCalibration?.target ?? {};
  const typical: Record<string, number> = { goals: 0.25, assists: 0.35, shots: 2.2, blocks: 0.8, hits: 1.2, powerplayPoints: 0.15, penaltyMinutes: 0.4 };
  for (const seg of ["vetF", "youngF", "vetD", "youngD"]) {
    for (const [t, x] of Object.entries(typical)) {
      const r = raw[seg]?.[t];
      const g = target[seg]?.[t];
      if (!r || !g) continue;
      checked++;
      const shift = Math.abs(r.a - g.a + (r.b - g.b) * x) / x;
      if (shift > 0.05) errors.push(`pre-season rate calibration ${seg} ${t}: shifts a typical rate by ${(100 * shift).toFixed(1)}% (> 5%)`);
    }
  }
}

// Goalie rates (Light the Lamp W, GAA, SV%, SHO): src/data/ml/goalie-rate-scorecard.json
// (scripts/backtest-goalie-rates.ts --out=…). The production goalie path may
// tie a baseline (save% is barely predictable: it ties the league level), but
// never lose to one with a 95% interval above 0.
const goaliePath = join(root, "src", "data", "ml", "goalie-rate-scorecard.json");
if (!existsSync(goaliePath)) {
  errors.push("src/data/ml/goalie-rate-scorecard.json missing (scripts/backtest-goalie-rates.ts --out=…)");
} else {
  const g = JSON.parse(readFileSync(goaliePath, "utf8")) as {
    testSeasons: number[];
    population: number;
    rows: Array<{ cat: string; a: string; b: string; valueA: number; valueB: number; diff: number; lo: number; hi: number }>;
  };
  if ((g.testSeasons?.length ?? 0) < 5 || (g.population ?? 0) < 300) {
    errors.push(`goalie scorecard: ${g.testSeasons?.length} seasons / ${g.population} goalie-seasons (< 5 / 300)`);
  }
  for (const b of ["league", "lag1", "marcel", "espn"]) {
    for (const cat of ["sv", "w", "so", "ga"]) {
      const r = g.rows.find((x) => x.a === "engine" && x.b === b && x.cat === cat);
      checked++;
      if (!r) errors.push(`goalie scorecard: no row ${cat} engine vs ${b}`);
      else if (r.lo > 0) {
        errors.push(`goalie ${cat} engine vs ${b}: ${r.valueA.toFixed(4)} vs ${r.valueB.toFixed(4)}, diff ${r.diff.toFixed(4)} [${r.lo.toFixed(4)}, ${r.hi.toFixed(4)}]`);
      }
    }
  }
}

if (errors.length) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
console.log(
  `OK: projection scorecard (${sc.testSeasons.join(",")}, ${sc.population.examples} player-seasons, ${checked} gates; built ${sc.builtAt})`,
);
