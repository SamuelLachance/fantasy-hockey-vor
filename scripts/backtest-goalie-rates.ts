/**
 * Walk-forward scorecard of the pre-season goalie RATES (the Light the Lamp
 * goalie categories W, GAA, SV%, SHO, per game), against the ESPN market and
 * simple baselines, with player-clustered bootstrap error bars.
 *
 * Protocol. For each test season T (2019-20 .. 2025-26) the v2 goalie base
 * models are trained on the seasons before T, the goalie metas on the
 * out-of-sample signals of the seasons before T (from 2015-16, as
 * scripts/backtest-goalie-gp.ts), then every goalie with an eligible NHL
 * season before T who played 10+ games in T is projected through the
 * production path: inferGoalieForPlayer (wins, shutouts, shots against per
 * game) and projectGoalieSavePctDistinct (the published save%), exactly as
 * src/lib/ml/predict-v2.ts. Games played are scored elsewhere
 * (scripts/backtest-goalie-gp.ts, src/data/ml/goalie-gp-backtest.json).
 *
 * Methods
 *   engine   the production goalie projection (unchanged by this work)
 *   league   the league level of T (trend of the seasons before T) for save%,
 *            the position mean of the three seasons before T for the counts
 *   lag1     the last eligible season's rates
 *   marcel   5/4/3 seasons, regressed (save%: 1,500 shots of the league
 *            level; per-game counts: 30 games of the position mean)
 *   espn     ESPN's pre-season projection (src/data/ml/market-espn.json)
 *
 * Losses: save% absolute error ×1000 weighted by shots against in T; W/GP,
 * SO/GP and GA/GP absolute error weighted by min(60, GP) / 60.
 *
 * Usage: npx tsx scripts/backtest-goalie-rates.ts [--out=src/data/ml/goalie-rate-scorecard.json] [--boot=1000]
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import { sanitizeTargetSeasonRow } from "../src/lib/ml/features";
import {
  buildGoalieExamples,
  buildGoalieLeagueContext,
  buildGoalieLevels,
  buildGoalieMatrix,
  computeGoalieSignals,
  fitGoalieMetas,
  goalieEligible,
  inferGoalieForPlayer,
  projectGoalieSavePctDistinct,
  trainGoalieBoundary,
  type GoalieSeasonPredictions,
} from "../src/lib/ml/goalie-v2";
import { levelEstimate } from "../src/lib/ml/dataset-view";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";
import { loadMoneyPuckRegistrySync } from "../src/lib/moneypuck-goalies";
import type { MarketFile } from "./build-espn-market";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const POOL_FROM = 20152016;
const TEST_FROM = 20192020;
const MIN_TEST_GP = 10;

/** A goalie's per-game line: save%, wins, shutouts and goals against per game. */
export interface GoalieLine {
  sv: number;
  w: number;
  so: number;
  ga: number;
}
export const GOALIE_CATS = ["sv", "w", "so", "ga"] as const;
type Cat = (typeof GOALIE_CATS)[number];

function svOf(r: PlayerSeasonRow): number {
  return r.savePct > 1 ? r.savePct / 100 : r.savePct;
}
function shotsOf(r: PlayerSeasonRow): number {
  const sv = svOf(r);
  return sv > 0 && sv < 1 ? r.saves / sv : 0;
}
function lineOf(r: PlayerSeasonRow): GoalieLine | null {
  const shots = shotsOf(r);
  if (!(r.gamesPlayed > 0) || !(shots > 0)) return null;
  return {
    sv: svOf(r),
    w: (r.wins ?? 0) / r.gamesPlayed,
    so: (r.shutouts ?? 0) / r.gamesPlayed,
    ga: (shots - r.saves) / r.gamesPlayed,
  };
}

interface Rec {
  T: number;
  id: number;
  shots: number;
  gp: number;
  act: GoalieLine;
  pred: Record<string, GoalieLine | null>;
}

function seededRng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}

export interface GoalieRow {
  cat: Cat;
  a: string;
  b: string;
  valueA: number;
  valueB: number;
  diff: number;
  lo: number;
  hi: number;
  n: number;
}

function compareCat(recs: Rec[], cat: Cat, a: string, b: string, boot: number): GoalieRow | null {
  const by = new Map<number, { la: number; lb: number; w: number }>();
  let la = 0;
  let lb = 0;
  let W = 0;
  let n = 0;
  for (const r of recs) {
    const pa = r.pred[a];
    const pb = r.pred[b];
    if (!pa || !pb || !Number.isFinite(pa[cat]) || !Number.isFinite(pb[cat])) continue;
    const scale = cat === "sv" ? 1000 : 1;
    const w = cat === "sv" ? r.shots : Math.min(60, r.gp) / 60;
    const ea = Math.abs(pa[cat] - r.act[cat]) * scale;
    const eb = Math.abs(pb[cat] - r.act[cat]) * scale;
    const acc = by.get(r.id) ?? { la: 0, lb: 0, w: 0 };
    acc.la += w * ea;
    acc.lb += w * eb;
    acc.w += w;
    by.set(r.id, acc);
    la += w * ea;
    lb += w * eb;
    W += w;
    n++;
  }
  if (n === 0) return null;
  const players = [...by.values()];
  const rng = seededRng(11);
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
    diffs.push((sa - sb) / sw);
  }
  diffs.sort((x, y) => x - y);
  return {
    cat,
    a,
    b,
    valueA: la / W,
    valueB: lb / W,
    diff: (la - lb) / W,
    lo: diffs[Math.floor(0.025 * boot)],
    hi: diffs[Math.ceil(0.975 * boot) - 1],
    n,
  };
}

function main() {
  const boot = Number(arg("boot") ?? 1000);
  const ds = JSON.parse(readFileSync(join(process.cwd(), "src", "data", "ml", "dataset.json"), "utf8")) as MlDataset;
  const rows = ds.rows;
  attachDurability(rows);
  const registry = loadMoneyPuckRegistrySync();
  const league = buildGoalieLeagueContext(rows, registry);
  const examples = buildGoalieExamples(rows);
  const matrix = buildGoalieMatrix(examples, league, registry);
  const levels = buildGoalieLevels(rows);
  const marketPath = join(process.cwd(), "src", "data", "ml", "market-espn.json");
  const market = existsSync(marketPath) ? (JSON.parse(readFileSync(marketPath, "utf8")) as MarketFile) : null;

  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    if (!r.isGoalie) continue;
    const l = byPlayer.get(r.playerId) ?? [];
    l.push(r);
    byPlayer.set(r.playerId, l);
  }
  for (const l of byPlayer.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  const exBySeason = new Map<number, number[]>();
  examples.forEach((e, i) => {
    const l = exBySeason.get(e.seasonId) ?? [];
    l.push(i);
    exBySeason.set(e.seasonId, l);
  });

  /** Position means of the per-game counts over the three seasons before T (8+ GP goalies). */
  const countPrior = (T: number): GoalieLine => {
    let g = 0;
    let w = 0;
    let so = 0;
    let ga = 0;
    for (const r of rows) {
      if (!r.isGoalie || r.seasonId >= T || r.seasonId < T - 3 * 10001 || r.gamesPlayed < 8) continue;
      const shots = shotsOf(r);
      if (!(shots > 0)) continue;
      g += r.gamesPlayed;
      w += r.wins ?? 0;
      so += r.shutouts ?? 0;
      ga += shots - r.saves;
    }
    const svLevel = levelEstimate(Object.fromEntries(league.svPct), T);
    return { sv: Number.isFinite(svLevel) ? svLevel : 0.905, w: w / g, so: so / g, ga: ga / g };
  };

  const seasons = [...new Set(rows.map((r) => r.seasonId))].filter((s) => s >= POOL_FROM).sort();
  const pool: GoalieSeasonPredictions[] = [];
  const recs: Rec[] = [];
  for (const T of seasons) {
    const t0 = Date.now();
    const models = trainGoalieBoundary(examples, matrix, league, registry, T, levels);
    if (T >= TEST_FROM) {
      const metas = fitGoalieMetas(pool, T);
      const prior = countPrior(T);
      const espn = new Map((market?.seasons[String(T)]?.goalies ?? []).map((g) => [g.id, g]));
      for (const r of rows) {
        if (!r.isGoalie || r.seasonId !== T || r.gamesPlayed < MIN_TEST_GP) continue;
        const act = lineOf(r);
        if (!act) continue;
        const history = (byPlayer.get(r.playerId) ?? []).filter((h) => h.seasonId < T);
        const eligible = goalieEligible(history);
        if (eligible.length === 0) continue;
        const target = sanitizeTargetSeasonRow(r, rows);
        const res = inferGoalieForPlayer(models, metas, history, target, league, registry, levels);
        let engine: GoalieLine | null = null;
        if (res) {
          const sv = projectGoalieSavePctDistinct(history, T, target.team, league, registry);
          const shotsPg = res.rates.saves / Math.max(res.rates.savePct, 1e-6);
          engine = { sv, w: res.rates.wins, so: res.rates.shutouts, ga: shotsPg * (1 - sv) };
        }
        const last = eligible.at(-1)!;
        const lag1 = lineOf(last);
        // Marcel 5/4/3 over the three seasons before T.
        const wts = [5, 4, 3];
        let sh = 0;
        let sv = 0;
        let g = 0;
        let w = 0;
        let so = 0;
        let ga = 0;
        [1, 2, 3].forEach((k, i) => {
          for (const h of history.filter((x) => x.seasonId === T - k * 10001)) {
            const s = shotsOf(h);
            if (!(s > 0)) continue;
            sh += wts[i] * s;
            sv += wts[i] * h.saves;
            g += wts[i] * h.gamesPlayed;
            w += wts[i] * (h.wins ?? 0);
            so += wts[i] * (h.shutouts ?? 0);
            ga += wts[i] * (s - h.saves);
          }
        });
        const K = 5 * 30;
        const SH = 5 * 1500;
        const marcel: GoalieLine = {
          sv: (sv + SH * prior.sv) / (sh + SH),
          w: (w + K * prior.w) / (g + K),
          so: (so + K * prior.so) / (g + K),
          ga: (ga + K * prior.ga) / (g + K),
        };
        const e = espn.get(r.playerId);
        // A stat ESPN did not publish that season is null: NaN, not scored.
        const num = (x: number | null) => (x == null ? NaN : x);
        const espnLine: GoalieLine | null =
          e && e.gp > 0
            ? {
                sv: num(e.shotsAgainst) > 0 ? num(e.saves) / num(e.shotsAgainst) : NaN,
                w: num(e.wins) / e.gp,
                so: num(e.shutouts) / e.gp,
                ga: num(e.goalsAgainst) / e.gp,
              }
            : null;
        recs.push({
          T,
          id: r.playerId,
          shots: shotsOf(r),
          gp: r.gamesPlayed,
          act,
          pred: { engine, league: prior, lag1, marcel, espn: espnLine },
        });
      }
    }
    const idx = exBySeason.get(T) ?? [];
    const signals = computeGoalieSignals(models, idx.map((i) => examples[i]), idx, matrix, league, registry, levels);
    pool.push({ seasonId: T, examples: idx.map((i) => examples[i]), signals });
    console.log(`${T}: ${recs.filter((x) => x.T === T).length} goalies scored (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }

  const out: GoalieRow[] = [];
  const f = (x: number, d = 3) => x.toFixed(d);
  for (const b of ["league", "lag1", "marcel", "espn"]) {
    console.log(`\n== engine vs ${b} (diff < 0: engine better; 95% player-bootstrap CI; save% in points x1000)`);
    for (const cat of GOALIE_CATS) {
      const r = compareCat(recs, cat, "engine", b, boot);
      if (!r) continue;
      out.push(r);
      const sig = r.hi < 0 ? " **" : r.lo > 0 ? " !!" : "";
      console.log(
        `${cat.padEnd(4)} ${f(r.valueA, 4).padStart(8)} ${f(r.valueB, 4).padStart(8)} diff ${f(r.diff, 4)} [${f(r.lo, 4)}, ${f(r.hi, 4)}] n=${r.n}${sig}`,
      );
    }
  }
  const o = arg("out");
  if (o) {
    writeFileSync(
      o,
      JSON.stringify(
        {
          builtAt: new Date().toISOString(),
          testSeasons: [...new Set(recs.map((r) => r.T))],
          population: recs.length,
          rows: out,
        },
        null,
        1,
      ),
    );
    console.log(`wrote ${o}`);
  }
}

main();
