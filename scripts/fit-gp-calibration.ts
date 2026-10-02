/**
 * Fit the skater games-played calibration (src/data/ml/gp-calibration.json,
 * see src/lib/gp-calibration.ts) on walk-forward out-of-sample records, and
 * backtest it: for each season T, curves fitted on the seasons before T are
 * scored on T, against the raw model and the previous calibration (model GP
 * → the same players' realized GP of the two prior seasons, zeros out).
 *
 * Usage:
 *   npx tsx scripts/backtest-skater-oos.ts --out=<records.json>   (~8 min)
 *   npm run gp:fit -- --records=<records.json>
 *
 * Population: every skater a pre-season board projects with the v2 model
 * (10+ games at T-1 or T-2, or a usual training example), with 0 games at T
 * for those who did not play but were still around (an NHL game after T, or
 * on a club's list today); retirements and departures are left out.
 */
import { readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import {
  CALIBRATED_GP_CEILING,
  fitGroupCurves,
  fitIsotonic,
  GP_CALIBRATION_PATH,
  GP_GROUPS,
  gpGroupOf,
  predictIsotonic,
  type GpOosCalibration,
  type GpOosPair,
} from "../src/lib/gp-calibration";
import { readDatasetManifest } from "../src/lib/ml/dataset-manifest";
import { currentBundleTrainedAt } from "../src/lib/ml/rate-reference";
import { scheduledGamesForSeason } from "../src/lib/nhl-api";
import type { MlDataset } from "../src/lib/ml/types";

interface OosRecord {
  T: number;
  id: number;
  pos: string;
  young: boolean;
  surv: boolean;
  active: boolean;
  act82: number;
  gpModel: number;
}

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const recordsPath = arg("records");
if (!recordsPath) throw new Error("--records=<records.json> (scripts/backtest-skater-oos.ts) required");

const records = JSON.parse(readFileSync(recordsPath, "utf8")) as OosRecord[];
const pop = records.filter((r) => r.surv || r.active);
const groupOf = (r: OosRecord) => gpGroupOf(r.young, r.pos === "D");
const pairsOf = (rs: OosRecord[]): GpOosPair[] => rs.map((r) => ({ group: groupOf(r), x: r.gpModel, y: r.act82 }));
const apply = (curves: ReturnType<typeof fitGroupCurves>["curves"], r: OosRecord) =>
  Math.max(0, Math.min(CALIBRATED_GP_CEILING, predictIsotonic(curves[groupOf(r)], Math.round(r.gpModel))));

// Realized GP82 per player-season (the previous calibration's target).
const ds = JSON.parse(readFileSync("src/data/ml/dataset.json", "utf8")) as MlDataset;
const gp82 = new Map<string, number>();
for (const r of ds.rows) {
  if (r.isGoalie) continue;
  const k = `${r.playerId}:${r.seasonId}`;
  gp82.set(k, Math.min(82, (gp82.get(k) ?? 0) + (r.gamesPlayed * 82) / scheduledGamesForSeason(r.seasonId)));
}
const prevId = (s: number, k: number) => s - 10001 * k;
function previousCurve(T: number) {
  const pairs: Array<{ x: number; y: number; w: number }> = [];
  for (const r of records.filter((x) => x.T === T)) {
    const g1 = gp82.get(`${r.id}:${prevId(T, 1)}`) ?? 0;
    const g2 = gp82.get(`${r.id}:${prevId(T, 2)}`) ?? 0;
    if (g1 > 0) pairs.push({ x: Math.round(r.gpModel), y: g1, w: 0.65 });
    if (g2 > 0) pairs.push({ x: Math.round(r.gpModel), y: g2, w: 0.35 });
  }
  return fitIsotonic(pairs);
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
function score(p: number[], a: number[]) {
  const ma = mean(a);
  const sse = p.reduce((s, x, i) => s + (x - a[i]!) ** 2, 0);
  const sst = a.reduce((s, x) => s + (x - ma) ** 2, 0);
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return { n: a.length, mae: r(mean(p.map((x, i) => Math.abs(x - a[i]!)))), bias: r(mean(p.map((x, i) => x - a[i]!))), r2: r(1 - sse / sst) };
}

const tests = [...new Set(pop.map((r) => r.T))].sort((a, b) => a - b).slice(2);
const preds: Record<"model" | "previous" | "calibrated", number[]> = { model: [], previous: [], calibrated: [] };
const scored: OosRecord[] = [];
for (const T of tests) {
  const { curves } = fitGroupCurves(pairsOf(pop.filter((r) => r.T < T)));
  const prev = previousCurve(T);
  for (const r of pop.filter((x) => x.T === T)) {
    scored.push(r);
    preds.model.push(Math.round(r.gpModel));
    preds.previous.push(Math.max(1, Math.min(CALIBRATED_GP_CEILING, Math.round(predictIsotonic(prev, Math.round(r.gpModel))))));
    preds.calibrated.push(apply(curves, r));
  }
}
const actual = scored.map((r) => r.act82);
const sub = (f: (r: OosRecord) => boolean) => {
  const idx = scored.map((r, i) => (f(r) ? i : -1)).filter((i) => i >= 0);
  return Object.fromEntries(
    Object.entries(preds).map(([k, p]) => [k, score(idx.map((i) => p[i]!), idx.map((i) => actual[i]!))]),
  );
};
const BINS: Array<[number, number]> = [[0, 40], [40, 50], [50, 60], [60, 66], [66, 72], [72, 90]];
const binBias = (f: (r: OosRecord) => boolean) =>
  Object.fromEntries(
    BINS.map(([lo, hi]) => {
      const idx = scored.map((r, i) => (f(r) && r.gpModel >= lo && r.gpModel < hi ? i : -1)).filter((i) => i >= 0);
      return [
        `${lo}-${hi}`,
        Object.fromEntries(Object.entries(preds).map(([k, p]) => [k, Math.round(mean(idx.map((i) => p[i]! - actual[i]!)) * 10) / 10])),
      ];
    }),
  );
const backtest = {
  testSeasons: tests,
  all: sub(() => true),
  survivors: sub((r) => r.surv),
  young: sub((r) => r.young),
  defense: sub((r) => r.pos === "D"),
  biasByModelGp: binBias(() => true),
  biasByModelGpYoung: binBias((r) => r.young),
  biasByModelGpDefense: binBias((r) => r.pos === "D"),
};

const { curves, pairCount } = fitGroupCurves(pairsOf(pop));
const round2 = (v: number) => Math.round(v * 100) / 100;
const out: GpOosCalibration = {
  version: 2,
  fittedAt: new Date().toISOString(),
  bundleTrainedAt: currentBundleTrainedAt(),
  datasetSha1: readDatasetManifest()?.sha1 ?? null,
  source: `walk-forward v2 out-of-sample, ${Math.min(...pop.map((r) => r.T))}-${Math.max(...pop.map((r) => r.T))}: ${pop.length} skater-seasons (${pop.filter((r) => !r.surv).length} under 10 games, 0 included; ${records.length - pop.length} retirements / departures left out)`,
  curves: Object.fromEntries(GP_GROUPS.map((g) => [g, curves[g].map((c) => ({ x: round2(c.x), y: round2(c.y) }))])) as GpOosCalibration["curves"],
  pairCount,
  backtest,
};
writeFileAtomic(GP_CALIBRATION_PATH, `${JSON.stringify(out, null, 2)}\n`);

const line = (name: string, s: Record<string, { n: number; mae: number; bias: number; r2: number }>) =>
  console.log(
    `${name.padEnd(10)} ${Object.entries(s)
      .map(([k, v]) => `${k} MAE ${v.mae.toFixed(2)} bias ${v.bias >= 0 ? "+" : ""}${v.bias.toFixed(2)} R² ${v.r2.toFixed(3)}`)
      .join(" | ")} (n ${Object.values(s)[0]?.n})`,
  );
console.log(`walk-forward backtest, ${tests.join(", ")}:`);
line("all", backtest.all);
line("survivors", backtest.survivors);
line("young", backtest.young);
line("defense", backtest.defense);
console.log("bias by model GP:", JSON.stringify(backtest.biasByModelGp));
console.log(`wrote ${GP_CALIBRATION_PATH}: ${out.source}; pairs ${JSON.stringify(pairCount)}`);
