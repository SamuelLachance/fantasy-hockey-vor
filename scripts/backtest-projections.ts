/**
 * Walk-forward scorecard of the pre-season skater projections against the
 * market and simple strong baselines, for every fantasy category and for
 * each league's scoring (Captains and Slapshot points, Light the Lamp
 * categories), by tier, with player-clustered bootstrap error bars.
 *
 * Inputs
 *   - src/data/ml/dataset.json (gitignored; the bundle's training dataset)
 *   - the walk-forward base-signal cache (scripts/backtest-projections-signals.ts)
 *   - src/data/ml/market-espn.json: ESPN's pre-season projections
 *     (scripts/build-espn-market.ts), the market consensus
 *
 * Protocol. For each test season T, everything fitted downstream of the base
 * models (meta-learners, the shipped post-hoc rate step) is fitted on the
 * cached walk-forward seasons < T only. The population is every skater the
 * stack projects (an eligible NHL season before T) who played 10+ games at
 * T; totals are 82-game equivalents (actual GP x 82 / scheduled games) so the
 * shortened seasons weigh like the others. Methods compared on the same
 * players; market comparisons on the players ESPN projected.
 *
 * Methods
 *   engine     the v2 stack as shipped at bd259b2 (src/lib/ml/stack.ts metas)
 *   candidate  the shipped stack: metas under SHIPPED_META_WEIGHTING, then
 *              the ESPN market blend (src/lib/ml/market-blend.ts)
 *   marcel543  classic Marcel: 5/4/3 season weights, 40 GP of position mean,
 *              Tango age adjustment; GP = 0.5 x last + 0.1 x previous + 24.6
 *   lag1       last eligible season's rates and games
 *   ageCurve   the fitted Marcel x aging curve rate (signal "marcel"), market GP
 *   synth      the repo's synthetic market (0.5 Marcel + 0.3 EWMA + 0.2 lag-1)
 *   espn       ESPN's pre-season projection (rates = projected / projected GP)
 *
 * Usage:
 *   npx tsx scripts/backtest-projections.ts --signals=<cache dir>
 *     [--seasons=20192020,...] [--boot=1000] [--out=<scorecard.json>]
 */

import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import {
  actualRate,
  buildSkaterExamples,
  eligibleHistory,
  gp82,
  type SkaterExample,
} from "../src/lib/ml/dataset-view";
import { marketGp } from "../src/lib/ml/market-training";
import {
  BASE_SIGNALS,
  fitStackedMetas,
  LEGACY_META_WEIGHTING,
  metaGpPrediction,
  metaRatePrediction,
  SHIPPED_META_WEIGHTING,
  stackLinesOutOfSample,
  V2_SKATER_TARGETS,
  type BaseSignal,
  type BaseSignalSet,
  type MetaWeighting,
  type SeasonPredictions,
} from "../src/lib/ml/stack";
import {
  applyMarketBlend,
  fitMarketBlendOnSeasons,
  marketLinesFor,
  MARKET_BLEND_STATS,
  type MarketBlend,
  type MarketFileShape,
  type StackLines,
} from "../src/lib/ml/market-blend";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { skaterRatesFromProjection } from "../src/lib/fantrax/points-model";
import { skaterSlotPoints, type ScoringTable } from "../src/lib/fantrax/scoring";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";
import type { SignalFile } from "./backtest-projections-signals";
import type { MarketFile } from "./build-espn-market";

// ---------------------------------------------------------------------------
// Loading

export interface Backtest {
  rows: PlayerSeasonRow[];
  byPlayer: Map<number, PlayerSeasonRow[]>;
  /** Walk-forward seasons with their base signals, ascending. */
  seasons: SeasonPredictions[];
  market: MarketFile | null;
}

export function loadBacktest(signalDir: string, dataPath?: string): Backtest {
  const ds = JSON.parse(
    readFileSync(dataPath ?? join(process.cwd(), "src", "data", "ml", "dataset.json"), "utf8"),
  ) as MlDataset;
  const rows = ds.rows;
  attachDurability(rows);
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    const l = byPlayer.get(r.playerId) ?? [];
    l.push(r);
    byPlayer.set(r.playerId, l);
  }
  for (const l of byPlayer.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  const examples = buildSkaterExamples(rows);
  const exByKey = new Map<string, SkaterExample>();
  for (const ex of examples) exByKey.set(`${ex.playerId}-${ex.seasonId}`, ex);

  const seasons: SeasonPredictions[] = [];
  const files = readdirSync(signalDir).filter((f) => /^signals-\d{8}\.json$/.test(f)).sort();
  for (const f of files) {
    const file = JSON.parse(readFileSync(join(signalDir, f), "utf8")) as SignalFile;
    if (file.signals.join() !== BASE_SIGNALS.join()) throw new Error(`${f}: signal order differs`);
    const exs: SkaterExample[] = [];
    const n = file.records.length;
    const rates: BaseSignalSet["rates"] = {};
    for (const t of V2_SKATER_TARGETS) {
      rates[t] = Object.fromEntries(BASE_SIGNALS.map((s) => [s, new Float64Array(n)])) as Record<BaseSignal, Float64Array>;
    }
    const gp: BaseSignalSet["gp"] = {
      gbdt: new Float64Array(n),
      ridge: new Float64Array(n),
      ewma: new Float64Array(n),
      lag1: new Float64Array(n),
      durability: new Float64Array(n),
    };
    file.records.forEach((r, k) => {
      const ex = exByKey.get(`${r.id}-${r.T}`);
      if (!ex) throw new Error(`${f}: no example ${r.id}-${r.T} in the dataset`);
      exs.push(ex);
      for (const t of V2_SKATER_TARGETS) {
        BASE_SIGNALS.forEach((s, j) => (rates[t][s][k] = r.sig[t][j]));
      }
      gp.gbdt[k] = r.gp[0];
      gp.ridge[k] = r.gp[1];
      gp.ewma[k] = r.gp[2];
      gp.lag1[k] = r.gp[3];
      gp.durability[k] = r.gp[4];
    });
    seasons.push({ seasonId: file.boundary, examples: exs, exampleRows: [], signals: { rates, gp } });
  }
  const marketPath = join(process.cwd(), "src", "data", "ml", "market-espn.json");
  const market = existsSync(marketPath) ? (JSON.parse(readFileSync(marketPath, "utf8")) as MarketFile) : null;
  return { rows, byPlayer, seasons, market };
}

// ---------------------------------------------------------------------------
// Predictions

export const STATS = V2_SKATER_TARGETS;
export type Stat = (typeof STATS)[number];

/** One method's projection of one example: per-game rates and 82-game GP. */
export interface Projection {
  rates: Record<Stat, number>;
  gp: number;
}

export type MethodFn = (season: SeasonPredictions, pool: SeasonPredictions[]) => Array<Projection | null>;

/** The stack's metas under one weighting (default: bd259b2's Kelly weights). */
export function engineMethod(metaWeighting: MetaWeighting = LEGACY_META_WEIGHTING): MethodFn {
  return (season, pool) => {
    const { rateMetas, gpMeta } = fitStackedMetas(pool, season.seasonId, undefined, metaWeighting);
    return season.examples.map((ex, k) => {
      const young = eligibleHistory(ex.history).length <= 2;
      const isD = ex.targetRow.position === "D";
      const rates = {} as Record<Stat, number>;
      for (const t of STATS) {
        rates[t] = metaRatePrediction(rateMetas[t], season.signals.rates[t], k, young, isD, true);
      }
      return { rates, gp: metaGpPrediction(gpMeta, season.signals.gp, k, young) };
    });
  };
}

/** A method that reads one base signal for the rates and the market GP. */
export function signalMethod(signal: BaseSignal): MethodFn {
  return (season) =>
    season.examples.map((ex, k) => {
      const rates = {} as Record<Stat, number>;
      for (const t of STATS) rates[t] = Math.max(0, season.signals.rates[t][signal][k]);
      return { rates, gp: marketGp(ex.history) };
    });
}

export function lag1Method(): MethodFn {
  return (season) =>
    season.examples.map((ex) => {
      const last = eligibleHistory(ex.history).at(-1);
      if (!last) return null;
      const rates = {} as Record<Stat, number>;
      for (const t of STATS) rates[t] = actualRate(last, t);
      return { rates, gp: Math.min(82, gp82(last)) };
    });
}

/**
 * Classic Marcel (Tango): the last three seasons weighted 5/4/3 (rows of any
 * games count), regressed with 40 games (at the latest season's weight 5) of
 * the position group's mean rate over the three seasons before T, age-adjusted
 * toward 29.
 */
export function marcel543Method(bt: Backtest): MethodFn {
  return (season) => {
    const T = season.seasonId;
    const prior: Record<"F" | "D", Record<Stat, number>> = { F: {} as Record<Stat, number>, D: {} as Record<Stat, number> };
    for (const g of ["F", "D"] as const) {
      for (const t of STATS) {
        let s = 0;
        let n = 0;
        for (const r of bt.rows) {
          if (r.isGoalie || r.seasonId >= T || r.seasonId < T - 3 * 10001) continue;
          if ((r.position === "D" ? "D" : "F") !== g) continue;
          s += (r as unknown as Record<string, number>)[t] ?? 0;
          n += r.gamesPlayed;
        }
        prior[g][t] = n > 0 ? s / n : 0;
      }
    }
    return season.examples.map((ex) => {
      const g = ex.targetRow.position === "D" ? "D" : "F";
      const w = [5, 4, 3];
      const rates = {} as Record<Stat, number>;
      const last3 = [1, 2, 3].map((k) => ex.history.filter((r) => r.seasonId === T - k * 10001));
      const age = ex.targetRow.age ?? 27;
      const ageAdj = age < 29 ? 1 + (29 - age) * 0.006 : 1 - (age - 29) * 0.003;
      for (const t of STATS) {
        let num = 0;
        let den = 0;
        last3.forEach((rs, k) => {
          for (const r of rs) {
            num += w[k] * ((r as unknown as Record<string, number>)[t] ?? 0);
            den += w[k] * r.gamesPlayed;
          }
        });
        const K = 5 * 40;
        rates[t] = ((num + K * prior[g][t]) / (den + K)) * ageAdj;
      }
      // Tango's playing time: 0.5 x last season + 0.1 x the one before + 30% of a season.
      const gps = last3.map((rs) => rs.reduce((s, r) => s + gp82(r), 0));
      const gp = 0.5 * gps[0] + 0.1 * gps[1] + 0.3 * 82;
      return { rates, gp: Math.min(82, Math.max(10, gp)) };
    });
  };
}

/** ESPN's pre-season projection; null where ESPN did not project him. */
export function espnMethod(bt: Backtest): MethodFn {
  return (season) => {
    const lines = marketLinesFor(bt.market as MarketFileShape | null, season.seasonId);
    return season.examples.map((ex) => {
      const m = lines.get(ex.playerId);
      return m ? { rates: { ...m.rates, faceoffWins: NaN }, gp: m.gp } : null;
    });
  };
}

/**
 * The shipped skater projection: metas under SHIPPED_META_WEIGHTING, then the
 * market blend (src/lib/ml/market-blend.ts) whose weights are fitted, for a
 * test season T, on the stack's out-of-sample lines of the seasons < T that
 * the market projected, exactly as scripts/train-v2.ts fits them for the
 * projection season.
 */
export function candidateMethod(bt: Backtest, onBlend?: (T: number, b: MarketBlend) => void): MethodFn {
  let lines: StackLines | null = null;
  return (season, pool) => {
    lines ??= new Map(stackLinesOutOfSample(bt.seasons, SHIPPED_META_WEIGHTING).map((x) => [x.seasonId, x.lines]));
    const blend = fitMarketBlendOnSeasons(pool, lines, bt.market as MarketFileShape | null);
    if (blend) onBlend?.(season.seasonId, blend);
    const market = marketLinesFor(bt.market as MarketFileShape | null, season.seasonId);
    const stack = engineMethod(SHIPPED_META_WEIGHTING)(season, pool);
    return stack.map((p, k) => {
      if (!p) return null;
      const out = applyMarketBlend(blend, market.get(season.examples[k].playerId), p.rates, p.gp);
      return { rates: out.rates, gp: out.gp };
    });
  };
}

// ---------------------------------------------------------------------------
// Scoring

const CAPTAINS: ScoringTable = JSON.parse(
  readFileSync(join(process.cwd(), "src", "data", "fantrax", "league.json"), "utf8"),
).scoring;
const SLAPSHOT: ScoringTable = JSON.parse(
  readFileSync(join(process.cwd(), "src", "data", "fantrax", "slapshot", "league.json"), "utf8"),
).scoring;

/** Fantasy points per game of a per-game stat line, as the league tools score it. */
export function pointsPerGame(table: ScoringTable, r: Record<Stat, number>, isD: boolean): number {
  const rates = skaterRatesFromProjection(
    { gamesPlayed: 1, goals: r.goals, assists: r.assists, shots: r.shots, hits: r.hits, blocks: r.blocks, powerplayPoints: r.powerplayPoints },
    { primaryD: isD, dEligible: isD },
  );
  return skaterSlotPoints(table, rates, isD ? "D" : "Default", { isD });
}

export const LTL_CATS = ["goals", "assists", "powerplayPoints", "shots", "hits", "blocks"] as const;

/** One scored example: what every metric needs. */
export interface Scored {
  T: number;
  id: number;
  isD: boolean;
  /** Weight of a rate error: min(60, GP) / 60. */
  w: number;
  gpAct: number;
  act: Record<Stat, number>;
  pred: Record<string, Projection | null>;
  /** Ex-ante tier (rank of the synthetic market's Captains points in T). */
  tier: string;
  lastPpg: number;
  young: boolean;
}

export function scoreSeasons(bt: Backtest, methods: Record<string, MethodFn>, testSeasons: number[]): Scored[] {
  const out: Scored[] = [];
  for (const T of testSeasons) {
    const season = bt.seasons.find((s) => s.seasonId === T);
    if (!season) throw new Error(`no cached signals for ${T}`);
    const pool = bt.seasons.filter((s) => s.seasonId < T);
    const preds: Record<string, Array<Projection | null>> = {};
    for (const [name, fn] of Object.entries(methods)) preds[name] = fn(season, pool);
    // Ex-ante tiers from the synthetic market (neutral to every method).
    const synth = signalMethod("market")(season, pool);
    const fp = synth.map((p, k) =>
      p ? pointsPerGame(CAPTAINS, p.rates, season.examples[k].targetRow.position === "D") * p.gp : 0,
    );
    const order = fp.map((v, k) => ({ v, k })).sort((a, b) => b.v - a.v);
    const rank = new Array(fp.length).fill(0);
    order.forEach((o, r) => (rank[o.k] = r + 1));
    season.examples.forEach((ex, k) => {
      const act = {} as Record<Stat, number>;
      for (const t of STATS) act[t] = actualRate(ex.actualRow, t);
      const last = eligibleHistory(ex.history).at(-1)!;
      const pred: Record<string, Projection | null> = {};
      for (const name of Object.keys(methods)) pred[name] = preds[name][k];
      out.push({
        T,
        id: ex.playerId,
        isD: ex.targetRow.position === "D",
        w: Math.min(60, ex.actualRow.gamesPlayed) / 60,
        gpAct: Math.min(82, gp82(ex.actualRow)),
        act,
        pred,
        tier: rank[k] <= 60 ? "1-60" : rank[k] <= 180 ? "61-180" : rank[k] <= 360 ? "181-360" : "361+",
        lastPpg: (last.goals + last.assists) / Math.max(1, last.gamesPlayed),
        young: eligibleHistory(ex.history).length <= 2,
      });
    });
  }
  return out;
}

/** A per-example loss (lower is better) and its weight; null = not scored. */
export type LossFn = (s: Scored, p: Projection) => { loss: number; w: number } | null;

const per82 = 82;
export const rateLoss = (t: Stat): LossFn => (s, p) =>
  Number.isFinite(p.rates[t]) ? { loss: Math.abs(p.rates[t] - s.act[t]) * per82, w: s.w } : null;
export const rateBias = (t: Stat): LossFn => (s, p) =>
  Number.isFinite(p.rates[t]) ? { loss: (p.rates[t] - s.act[t]) * per82, w: s.w } : null;
export const totalLoss = (t: Stat): LossFn => (s, p) =>
  Number.isFinite(p.rates[t]) ? { loss: Math.abs(p.rates[t] * p.gp - s.act[t] * s.gpAct), w: 1 } : null;
export const gpLoss: LossFn = (s, p) => ({ loss: Math.abs(p.gp - s.gpAct), w: 1 });
export const fpLoss = (table: ScoringTable): LossFn => (s, p) => ({
  loss: Math.abs(pointsPerGame(table, p.rates, s.isD) * p.gp - pointsPerGame(table, s.act, s.isD) * s.gpAct),
  w: 1,
});
export const fpBias = (table: ScoringTable): LossFn => (s, p) => ({
  loss: pointsPerGame(table, p.rates, s.isD) * p.gp - pointsPerGame(table, s.act, s.isD) * s.gpAct,
  w: 1,
});
export const fpRateLoss = (table: ScoringTable): LossFn => (s, p) => ({
  loss: Math.abs(pointsPerGame(table, p.rates, s.isD) - pointsPerGame(table, s.act, s.isD)) * per82,
  w: s.w,
});
export const fpRateBias = (table: ScoringTable): LossFn => (s, p) => ({
  loss: (pointsPerGame(table, p.rates, s.isD) - pointsPerGame(table, s.act, s.isD)) * per82,
  w: s.w,
});
export const squared = (l: LossFn): LossFn => (s, p) => {
  const r = l(s, p);
  return r && { loss: r.loss * r.loss, w: r.w };
};
export { CAPTAINS, SLAPSHOT };

function seededRng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export interface Comparison {
  a: number;
  b: number;
  /** a − b with a 95% player-clustered bootstrap interval. */
  diff: number;
  lo: number;
  hi: number;
  n: number;
}

/**
 * Weighted mean loss of methods `a` and `b` on the examples both scored, and
 * the bootstrap interval of the difference, resampling PLAYERS (all their
 * seasons together) so repeated players do not shrink the interval.
 */
export function compare(data: Scored[], loss: LossFn, a: string, b: string, boot = 1000, seed = 7): Comparison {
  const byPlayer = new Map<number, { la: number; lb: number; w: number }>();
  let la = 0;
  let lb = 0;
  let w = 0;
  let n = 0;
  for (const s of data) {
    const pa = s.pred[a];
    const pb = s.pred[b];
    if (!pa || !pb) continue;
    const ra = loss(s, pa);
    const rb = loss(s, pb);
    if (!ra || !rb || !Number.isFinite(ra.loss) || !Number.isFinite(rb.loss)) continue;
    const acc = byPlayer.get(s.id) ?? { la: 0, lb: 0, w: 0 };
    acc.la += ra.w * ra.loss;
    acc.lb += ra.w * rb.loss;
    acc.w += ra.w;
    byPlayer.set(s.id, acc);
    la += ra.w * ra.loss;
    lb += ra.w * rb.loss;
    w += ra.w;
    n++;
  }
  const players = [...byPlayer.values()];
  const rng = seededRng(seed);
  const diffs: number[] = [];
  for (let i = 0; i < boot; i++) {
    let sa = 0;
    let sb = 0;
    let sw = 0;
    for (let j = 0; j < players.length; j++) {
      const p = players[Math.floor(rng() * players.length)];
      sa += p.la;
      sb += p.lb;
      sw += p.w;
    }
    diffs.push(sw > 0 ? (sa - sb) / sw : 0);
  }
  diffs.sort((x, y) => x - y);
  return {
    a: w > 0 ? la / w : NaN,
    b: w > 0 ? lb / w : NaN,
    diff: w > 0 ? (la - lb) / w : NaN,
    lo: diffs[Math.floor(0.025 * boot)] ?? NaN,
    hi: diffs[Math.ceil(0.975 * boot) - 1] ?? NaN,
    n,
  };
}

/** Spearman rank correlation of a method's season value vs the actual, per season, averaged. */
export function spearmanBySeason(
  data: Scored[],
  method: string,
  value: (s: Scored, p: Projection) => number,
  actual: (s: Scored) => number,
  only?: (s: Scored) => boolean,
): number {
  const seasons = [...new Set(data.map((d) => d.T))];
  let sum = 0;
  let cnt = 0;
  for (const T of seasons) {
    const pts = data.filter((d) => d.T === T && d.pred[method] && (!only || only(d)));
    if (pts.length < 10) continue;
    const xs = pts.map((d) => value(d, d.pred[method]!));
    const ys = pts.map((d) => actual(d));
    sum += spearman(xs, ys);
    cnt++;
  }
  return cnt > 0 ? sum / cnt : NaN;
}

function ranks(v: number[]): number[] {
  const idx = v.map((x, i) => ({ x, i })).sort((a, b) => a.x - b.x);
  const r = new Array(v.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].x === idx[i].x) j++;
    for (let k = i; k <= j; k++) r[idx[k].i] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

export function spearman(x: number[], y: number[]): number {
  const rx = ranks(x);
  const ry = ranks(y);
  const n = x.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n;
  const my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (rx[i] - mx) * (ry[i] - my);
    sxx += (rx[i] - mx) ** 2;
    syy += (ry[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

/**
 * Light the Lamp category value of a season line: Σ over the six skater
 * categories of (total − mean) / sd, with the mean and sd of the ACTUAL
 * totals of the season's examples (one fixed yardstick for every method).
 */
export function ltlValueFn(data: Scored[]): (s: Scored, rates: Record<Stat, number>, gp: number) => number {
  const norm = new Map<number, Record<string, { m: number; sd: number }>>();
  for (const T of new Set(data.map((d) => d.T))) {
    const pts = data.filter((d) => d.T === T);
    const rec: Record<string, { m: number; sd: number }> = {};
    for (const c of LTL_CATS) {
      const v = pts.map((d) => d.act[c] * d.gpAct);
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
      rec[c] = { m, sd };
    }
    norm.set(T, rec);
  }
  return (s, rates, gp) => {
    const rec = norm.get(s.T)!;
    let v = 0;
    for (const c of LTL_CATS) v += (rates[c] * gp - rec[c].m) / rec[c].sd;
    return v;
  };
}

// ---------------------------------------------------------------------------
// Scorecard

export interface ScorecardRow {
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

export function scorecard(data: Scored[], candidate: string, comparators: string[], boot: number): ScorecardRow[] {
  const out: ScorecardRow[] = [];
  const ltl = ltlValueFn(data);
  const ltlLoss: LossFn = (s, p) =>
    LTL_CATS.every((c) => Number.isFinite(p.rates[c])) ? { loss: Math.abs(ltl(s, p.rates, p.gp) - ltl(s, s.act, s.gpAct)), w: 1 } : null;
  const metrics: Array<[string, LossFn]> = [
    ...STATS.map((t): [string, LossFn] => [`rate MAE/82 ${t}`, rateLoss(t)]),
    ...LTL_CATS.map((t): [string, LossFn] => [`total MAE ${t}`, totalLoss(t)]),
    ["GP MAE", gpLoss],
    // Squared games error: the mean (what expected points need), where the
    // MAE rewards a median (ESPN's healthy-season games).
    ["GP MSE", squared(gpLoss)],
    ["Captains FP MAE", fpLoss(CAPTAINS)],
    ["Slapshot FP MAE", fpLoss(SLAPSHOT)],
    ["Captains FP/82 MAE", fpRateLoss(CAPTAINS)],
    ["Slapshot FP/82 MAE", fpRateLoss(SLAPSHOT)],
    ["LTL value MAE", ltlLoss],
    // Squared errors: what an expected-value draft board should minimize.
    ["Captains FP MSE", squared(fpLoss(CAPTAINS))],
    ["Slapshot FP MSE", squared(fpLoss(SLAPSHOT))],
    ["LTL value MSE", squared(ltlLoss)],
  ];
  const subsets: Array<[string, (s: Scored) => boolean]> = [
    ["all", () => true],
    ["tier 1-60", (s) => s.tier === "1-60"],
    ["tier 61-180", (s) => s.tier === "61-180"],
    ["tier 181-360", (s) => s.tier === "181-360"],
    ["young (<=2 seasons)", (s) => s.young],
  ];
  for (const b of comparators) {
    for (const [metric, loss] of metrics) {
      for (const [subset, keep] of subsets) {
        if (subset !== "all" && !/FP MAE|FP MSE|LTL|rate MAE\/82 (goals|assists)/.test(metric)) continue;
        const c = compare(data.filter(keep), loss, candidate, b, boot);
        if (c.n === 0) continue;
        out.push({ metric, subset, a: candidate, b, valueA: c.a, valueB: c.b, diff: c.diff, lo: c.lo, hi: c.hi, n: c.n });
      }
    }
  }
  return out;
}

export function printScorecard(rows: ScorecardRow[]): void {
  const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "-");
  let lastB = "";
  for (const r of rows) {
    if (r.b !== lastB) {
      console.log(`\n== ${r.a} vs ${r.b} (diff < 0: ${r.a} better; 95% player-bootstrap CI)`);
      lastB = r.b;
    }
    const sig = r.hi < 0 ? " **" : r.lo > 0 ? " !!" : "";
    console.log(
      `${(r.metric + " [" + r.subset + "]").padEnd(46)} ${f(r.valueA).padStart(8)} ${f(r.valueB).padStart(8)}  diff ${f(r.diff, 3).padStart(7)} [${f(r.lo, 3)}, ${f(r.hi, 3)}] n=${r.n}${sig}`,
    );
  }
}

/** Signed bias per tier, for the elite under-projection check. */
export function printBiasTable(data: Scored[], methods: string[]): void {
  const tiers: Array<[string, (s: Scored) => boolean]> = [
    ["tier 1-60", (s) => s.tier === "1-60"],
    ["tier 61-180", (s) => s.tier === "61-180"],
    ["tier 181-360", (s) => s.tier === "181-360"],
    ["last P/GP >= 0.9", (s) => s.lastPpg >= 0.9],
    ["last P/GP 0.6-0.9", (s) => s.lastPpg >= 0.6 && s.lastPpg < 0.9],
    ["last P/GP < 0.35", (s) => s.lastPpg < 0.35],
  ];
  console.log("\n== signed bias per 82 GP (pred - actual), rate level, GP-weighted");
  for (const [name, keep] of tiers) {
    const sub = data.filter(keep);
    const parts = methods.map((m) => {
      const g = compare(sub, rateBias("goals"), m, m, 0);
      const a = compare(sub, rateBias("assists"), m, m, 0);
      const fp = compare(sub, fpRateBias(CAPTAINS), m, m, 0);
      return `${m} G${g.a >= 0 ? "+" : ""}${g.a.toFixed(2)} A${a.a >= 0 ? "+" : ""}${a.a.toFixed(2)} CapFP${fp.a >= 0 ? "+" : ""}${fp.a.toFixed(1)}`;
    });
    console.log(`${name.padEnd(20)} n=${String(sub.length).padStart(5)}  ${parts.join(" | ")}`);
  }
}

// ---------------------------------------------------------------------------

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

async function main() {
  const signalDir = arg("signals");
  if (!signalDir) throw new Error("--signals=<walk-forward signal cache dir> required");
  const testSeasons = (arg("seasons") ?? "20192020,20202021,20212022,20222023,20232024,20242025,20252026")
    .split(",")
    .map(Number);
  const boot = Number(arg("boot") ?? 1000);
  const bt = loadBacktest(signalDir);
  const blends: string[] = [];
  const methods: Record<string, MethodFn> = {
    candidate: candidateMethod(bt, (T, b) =>
      blends.push(
        `${T}: gp ${b.gpBeta.toFixed(3)} ` + MARKET_BLEND_STATS.map((t) => `${t} ${b.betas[t].toFixed(3)}`).join(" "),
      ),
    ),
    engine: engineMethod(),
    marcel543: marcel543Method(bt),
    lag1: lag1Method(),
    ageCurve: signalMethod("marcel"),
    synth: signalMethod("market"),
    espn: espnMethod(bt),
  };
  const data = scoreSeasons(bt, methods, testSeasons);
  console.log("market blend weights per test season (fitted on the seasons before):");
  for (const b of blends) console.log(`  ${b}`);
  const lead = "candidate";
  const comparators = Object.keys(methods).filter((m) => m !== lead);
  const rows = scorecard(data, lead, comparators, boot);
  printScorecard(rows);
  printBiasTable(data, Object.keys(methods).filter((m) => m !== "espn"));
  const ltl = ltlValueFn(data);
  const rankings: Array<[string, (s: Scored, p: Projection) => number, (s: Scored) => number]> = [
    ["Captains FP", (s, p) => pointsPerGame(CAPTAINS, p.rates, s.isD) * p.gp, (s) => pointsPerGame(CAPTAINS, s.act, s.isD) * s.gpAct],
    ["Slapshot FP", (s, p) => pointsPerGame(SLAPSHOT, p.rates, s.isD) * p.gp, (s) => pointsPerGame(SLAPSHOT, s.act, s.isD) * s.gpAct],
    ["LTL value", (s, p) => ltl(s, p.rates, p.gp), (s) => ltl(s, s.act, s.gpAct)],
  ];
  console.log("\n== Spearman rank correlation with the realized season (per season, averaged): all / ESPN-projected players");
  const espnSet = (s: Scored) => Boolean(s.pred.espn);
  const spearmanRows: Array<{ ranking: string; method: string; all: number; espnSet: number }> = [];
  for (const [ranking, value, actual] of rankings) {
    for (const m of Object.keys(methods)) {
      const all = m === "espn" ? NaN : spearmanBySeason(data, m, value, actual);
      const sub = spearmanBySeason(data, m, value, actual, espnSet);
      spearmanRows.push({ ranking, method: m, all, espnSet: sub });
      console.log(`${ranking.padEnd(12)} ${m.padEnd(10)} all ${all.toFixed(4)}  espn-set ${sub.toFixed(4)}`);
    }
  }
  const out = arg("out");
  if (out) {
    const marketPath = join(process.cwd(), "src", "data", "ml", "market-espn.json");
    writeFileSync(
      out,
      JSON.stringify(
        {
          builtAt: new Date().toISOString(),
          testSeasons,
          signalSeasons: bt.seasons.map((s) => s.seasonId),
          config: {
            metaWeighting: SHIPPED_META_WEIGHTING,
            marketBlend: true,
            marketFileSha1: existsSync(marketPath) ? sha1(readFileSync(marketPath)) : null,
          },
          population: {
            examples: data.length,
            espnProjected: data.filter(espnSet).length,
          },
          blends,
          rows,
          spearman: spearmanRows,
        },
        null,
        1,
      ),
    );
    console.log(`wrote ${out}`);
  }
}

export function sha1(buf: Buffer): string {
  return createHash("sha1").update(buf).digest("hex");
}

if (process.argv[1]?.endsWith("backtest-projections.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
