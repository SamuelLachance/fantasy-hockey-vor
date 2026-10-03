/**
 * Walk-forward base signals of the v2 skater stack, cached per boundary for
 * scripts/backtest-projections.ts.
 *
 * For every boundary season T the base models (GBDT, ridge, Marcel, GP
 * models) are trained on target seasons < T only (src/lib/ml/stack.ts
 * trainBoundary, exactly as the production walk-forward), then score the
 * examples of season T. One record per example: identity, the actual season,
 * every base rate signal per target and the GP signals. The meta-learners
 * and everything downstream are fitted later from these records, strictly
 * on seasons < T, so the cache never leaks the scored season.
 *
 * Usage:
 *   npx tsx scripts/backtest-projections-signals.ts --cache=<dir>
 *     [--seasons=20162017,...,20252026] [--jobs=5] [--data=<dataset.json>]
 *   (one boundary, used by the parallel driver: --one=20212022)
 *
 * A boundary whose file exists is skipped (delete it, or --force, to rebuild).
 */

import { spawn } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { attachDurability } from "../src/lib/ml/gamelog-durability";
import {
  BASE_SIGNALS,
  computeBaseSignals,
  trainBoundary,
  V2_SKATER_TARGETS,
} from "../src/lib/ml/stack";
import {
  buildFeatureMatrix,
  buildLeagueContext,
  buildSkaterExamples,
  buildTargetLevels,
} from "../src/lib/ml/dataset-view";
import {
  buildTeamDepthFromRows,
  setTrainingTeamDepthCache,
  type TeamDepthContext,
} from "../src/lib/ml/team-depth";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

export const DEFAULT_SIGNAL_SEASONS = [
  20162017, 20172018, 20182019, 20192020, 20202021, 20212022, 20222023, 20232024, 20242025, 20252026,
];

export interface SignalRecord {
  T: number;
  id: number;
  /** Rate signals per target, in BASE_SIGNALS order. */
  sig: Record<string, number[]>;
  /** GP signals: gbdt, ridge, ewma, lag1, durability. */
  gp: number[];
}

export interface SignalFile {
  boundary: number;
  builtAt: string;
  datasetBuiltAt: string;
  signals: readonly string[];
  /** Env switches the base models were trained under (variants). */
  env: Record<string, string>;
  records: SignalRecord[];
}

const VARIANT_ENV = ["ML_MARKET_TRAINING", "ML_ADVERSARIAL", "ML_FEATURES", "ML_GBDT_RATE_OPTS", "ML_GBDT_GP_OPTS"];

function round(x: number): number {
  return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : NaN;
}

function buildOne(dataPath: string, cacheDir: string, boundary: number): void {
  const ds = JSON.parse(readFileSync(dataPath, "utf8")) as MlDataset;
  const rows = ds.rows;
  attachDurability(rows);
  const historyMap = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows) {
    const l = historyMap.get(r.playerId) ?? [];
    l.push(r);
    historyMap.set(r.playerId, l);
  }
  for (const l of historyMap.values()) l.sort((a, b) => a.seasonId - b.seasonId);
  const allSeasons = [...new Set(rows.map((r) => r.seasonId))].sort((a, b) => a - b);
  const depth = new Map<number, Map<number, TeamDepthContext>>();
  for (const s of allSeasons) depth.set(s, buildTeamDepthFromRows(rows, historyMap, s));
  setTrainingTeamDepthCache(depth);

  const t0 = Date.now();
  const league = buildLeagueContext(rows);
  const examples = buildSkaterExamples(rows);
  const levels = buildTargetLevels(rows, V2_SKATER_TARGETS, false);
  const matrix = buildFeatureMatrix(examples, league);
  const idx: number[] = [];
  examples.forEach((ex, i) => {
    if (ex.seasonId === boundary) idx.push(i);
  });
  const models = trainBoundary(examples, matrix, rows, boundary, levels);
  const sigs = computeBaseSignals(models, idx.map((i) => examples[i]), idx, matrix, levels);
  const records: SignalRecord[] = idx.map((i, k) => {
    const sig: Record<string, number[]> = {};
    for (const t of V2_SKATER_TARGETS) {
      sig[t] = BASE_SIGNALS.map((s) => round(sigs.rates[t][s][k]));
    }
    const g = sigs.gp;
    return {
      T: boundary,
      id: examples[i].playerId,
      sig,
      gp: [g.gbdt[k], g.ridge[k], g.ewma[k], g.lag1[k], g.durability[k]].map(round),
    };
  });
  const env: Record<string, string> = {};
  for (const k of VARIANT_ENV) if (process.env[k] != null) env[k] = process.env[k] as string;
  const file: SignalFile = {
    boundary,
    builtAt: new Date().toISOString(),
    datasetBuiltAt: ds.builtAt,
    signals: BASE_SIGNALS,
    env,
    records,
  };
  writeFileSync(join(cacheDir, `signals-${boundary}.json`), JSON.stringify(file));
  console.log(`boundary ${boundary}: ${records.length} examples in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}

async function main() {
  const cacheDir = arg("cache");
  if (!cacheDir) throw new Error("--cache=<dir> required");
  mkdirSync(cacheDir, { recursive: true });
  const dataPath = arg("data") ?? join(process.cwd(), "src", "data", "ml", "dataset.json");
  const one = arg("one");
  if (one) {
    buildOne(dataPath, cacheDir, Number(one));
    return;
  }
  const seasons = (arg("seasons")?.split(",").map(Number) ?? DEFAULT_SIGNAL_SEASONS).filter(
    (s) => process.argv.includes("--force") || !existsSync(join(cacheDir, `signals-${s}.json`)),
  );
  const jobs = Math.max(1, Number(arg("jobs") ?? 5));
  console.log(`signals: ${seasons.length} boundaries to build, ${jobs} at a time -> ${cacheDir}`);
  const queue = [...seasons];
  const runOne = (s: number) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [...process.execArgv, process.argv[1], `--cache=${cacheDir}`, `--data=${dataPath}`, `--one=${s}`],
        { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=6144" } },
      );
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`boundary ${s} exited ${code}`))));
    });
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let s = queue.shift(); s != null; s = queue.shift()) await runOne(s);
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
