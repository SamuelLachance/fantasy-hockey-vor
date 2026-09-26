/**
 * Fit the edge reference the rate calibration targets
 * (src/data/ml/rate-reference.json) from a healthy board generated with the
 * committed v2 bundle: per meta segment (young / veteran × F / D) and stat,
 * the edge ≈ a + b·market fit of that board's edges (a mean for stats
 * outside RATE_LINE_STATS), over the current board's v2 regulars (40+ GP)
 * found on it in the same segment.
 *
 * Default reference: commit 5291e33, the 2026-07-22 board of the current
 * bundle (trained 2026-07-22), generated before the 2026-07-30 dataset drift.
 * Refit after a retrain, from the first healthy board of the new bundle.
 *
 * Run: npm run rates:reference [-- --rev <commit>] [-- --players <file> --details <file>]
 */
import { execFileSync } from "child_process";
import { readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { currentBundleTrainedAt, RATE_REFERENCE_PATH } from "../src/lib/ml/rate-reference";
import type { PlayerDetailRecord } from "../src/lib/publish-players";
import {
  fitEdgeLines,
  legacyCappedCells,
  RATE_CALIBRATION_MIN_GP,
  RATE_KEYS,
  RATE_LINE_STATS,
  rateGroup,
  segmentFromReasoning,
  type EdgeSample,
  type ModelSegment,
  type RateReference,
  type RateSegment,
} from "../src/lib/rate-calibration";
import type { PlayerProjection, ProjectionsDataset, SkaterCategory, SkaterProjection } from "../src/lib/types";
import { SKATER_CATEGORIES } from "../src/lib/types";

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const REV = arg("--rev") ?? "5291e33";
const playersFile = arg("--players");
const detailsFile = arg("--details");

function readRef(path: string, file: string | undefined): string {
  if (file) return readFileSync(file, "utf8");
  return execFileSync("git", ["show", `${REV}:${path}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

type Details = Record<string, Partial<PlayerDetailRecord>>;
const current = JSON.parse(readFileSync("src/data/players.json", "utf8")) as ProjectionsDataset;
const currentDetails = JSON.parse(readFileSync("public/player-details.json", "utf8")) as Details;
const ref = JSON.parse(readRef("src/data/players.json", playersFile)) as ProjectionsDataset;
const refDetails = JSON.parse(readRef("public/player-details.json", detailsFile)) as Details;
const refById = new Map(ref.players.map((p) => [p.id, p]));

const trainedAt = currentBundleTrainedAt();
if (!trainedAt) throw new Error("src/data/ml/v2-bundle.json has no trainedAt");
const refTrained = new Set(
  Object.values(refDetails)
    .map((d) => d.reasoning?.match(/^v2 stacked ensemble.*Trained (\d{4}-\d{2}-\d{2})/)?.[1])
    .filter((x): x is string => Boolean(x)),
);
if (refTrained.size !== 1 || !trainedAt.startsWith([...refTrained][0])) {
  throw new Error(
    `reference board was generated with bundle(s) ${[...refTrained].join(", ") || "?"}, the committed bundle is ${trainedAt}: refusing`,
  );
}

const segmentOf = (d: Partial<PlayerDetailRecord> | undefined): ModelSegment | undefined =>
  d?.modelSegment ?? segmentFromReasoning(d?.reasoning);

const samples: EdgeSample[] = [];
let pool = 0;
let missing = 0;
for (const p of current.players) {
  const d = currentDetails[String(p.id)];
  if (p.isGoalie || p.projectionMethod !== "ml" || p.gamesPlayed < RATE_CALIBRATION_MIN_GP) continue;
  if (!d?.modelRates && !d?.marketEdge) continue;
  const segment = segmentOf(d);
  if (!segment) continue;
  pool++;
  const r = refById.get(p.id) as (PlayerProjection & { marketEdge?: Record<string, number> }) | undefined;
  const rd = refDetails[String(p.id)];
  const edgeIn = (r?.marketEdge ?? rd?.marketEdge) as Partial<Record<SkaterCategory, number>> | undefined;
  const group = rateGroup({ ...p, primaryPosition: p.primaryPosition ?? p.position });
  if (!r || r.isGoalie || r.projectionMethod !== "ml" || !edgeIn || !(r.gamesPlayed > 0) || segmentOf(rd) !== segment || rateGroup(r) !== group) {
    missing++;
    continue;
  }
  const proj = r.projection as SkaterProjection;
  const capped = new Set(legacyCappedCells({ ...r, projection: proj }));
  const market: Partial<Record<SkaterCategory, number>> = {};
  const edge: Partial<Record<SkaterCategory, number>> = {};
  for (const cat of SKATER_CATEGORIES) {
    const e = edgeIn[cat];
    if (typeof e !== "number" || !Number.isFinite(e)) continue;
    // A capped cell's implied market is wrong; its edge is still the model's.
    if (capped.has(cat) && RATE_LINE_STATS.includes(cat)) continue;
    market[cat] = proj[cat] / r.gamesPlayed - e;
    edge[cat] = e;
  }
  samples.push({
    group,
    segment: `${segment}${group}` as RateSegment,
    center: (p.primaryPosition ?? p.position) === "C",
    market,
    edge,
  });
}

const { lines, poolSize } = fitEdgeLines(samples);
const round = (v: number) => Math.round(v * 1e9) / 1e9;
for (const key of RATE_KEYS) {
  for (const cat of Object.keys(lines[key]) as SkaterCategory[]) {
    const l = lines[key][cat]!;
    lines[key][cat] = { a: round(l.a), b: round(l.b) };
  }
}
const reference: RateReference = {
  version: 1,
  bundleTrainedAt: trainedAt,
  source: `healthy board ${REV} (generated ${ref.generatedAt}), edges of ${samples.length} of the ${pool} current v2 regulars`,
  fittedAt: new Date().toISOString(),
  poolSize,
  lines,
};
writeFileAtomic(RATE_REFERENCE_PATH, `${JSON.stringify(reference, null, 2)}\n`);

console.log(`${reference.source} (${missing} not on it or in another segment)`);
const mean82 = (key: (typeof RATE_KEYS)[number], cat: SkaterCategory) => {
  const l = lines[key][cat];
  if (!l) return "-";
  const members = samples.filter((s) => (s.group === key || s.segment === key) && typeof s.market[cat] === "number");
  const m = members.reduce((s, x) => s + (x.market[cat] as number), 0) / Math.max(1, members.length);
  return ((l.a + l.b * m) * 82).toFixed(1);
};
for (const key of RATE_KEYS) {
  console.log(
    `  ${key.padEnd(6)} n ${String(poolSize[key]).padStart(3)} mean edge per 82: ${(["goals", "assists", "powerplayPoints", "shots", "hits", "blocks", "penaltyMinutes"] as SkaterCategory[]).map((c) => `${c} ${mean82(key, c)}`).join(", ")}`,
  );
}
console.log(`Wrote ${RATE_REFERENCE_PATH}`);
