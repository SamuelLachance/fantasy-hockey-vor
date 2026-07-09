/** Run: npx tsx scripts/benchmark-goalie-persistence.ts */
import { readFileSync } from "fs";
import { join } from "path";
import { buildGoalieGpExamples } from "../src/lib/ml/features";
import { evaluateRegression } from "../src/lib/ml/ridge";
import { spearmanCorrelation } from "../src/lib/ml/metrics";
import type { MlDataset, PlayerSeasonRow } from "../src/lib/ml/types";

const HOLDOUT = 20252026;
const DATA = join(process.cwd(), "src", "data", "ml", "dataset.json");

function buildMap(rows: PlayerSeasonRow[]) {
  const map = new Map<number, PlayerSeasonRow[]>();
  for (const r of rows.filter((x) => x.isGoalie)) {
    const list = map.get(r.playerId) ?? [];
    list.push(r);
    map.set(r.playerId, list);
  }
  for (const h of map.values()) h.sort((a, b) => a.seasonId - b.seasonId);
  return map;
}

function prior(
  map: Map<number, PlayerSeasonRow[]>,
  pid: number,
  sid: number,
): PlayerSeasonRow[] {
  const h = map.get(pid) ?? [];
  const i = h.findIndex((r) => r.seasonId === sid);
  return i > 0 ? h.slice(0, i) : [];
}

function ewmaRate(
  rows: PlayerSeasonRow[],
  fn: (r: PlayerSeasonRow) => number,
): number {
  const recent = rows.filter((r) => r.gamesPlayed >= 10).slice(-3);
  if (!recent.length) return 0;
  const w = [0.15, 0.3, 0.55].slice(-recent.length);
  const ws = w.reduce((a, b) => a + b, 0);
  return recent.reduce(
    (s, r, i) => s + (fn(r) / r.gamesPlayed) * (w[i] / ws),
    0,
  );
}

const dataset = JSON.parse(readFileSync(DATA, "utf8")) as MlDataset;
const map = buildMap(dataset.rows);
const holdout = buildGoalieGpExamples(dataset.rows).filter(
  (e) => e.seasonId === HOLDOUT,
);

const stats = ["gamesPlayed", "wins", "shutouts", "saves"] as const;

for (const stat of stats) {
  const y = holdout.map((ex) => ex.targetSeason[stat]);

  const lag1tot = holdout.map((ex) => {
    const p = prior(map, ex.playerId, ex.seasonId).at(-1);
    return p ? p[stat] : 0;
  });
  const m1 = evaluateRegression(y, lag1tot);

  const ewmaGp = holdout.map((ex) => {
    const p = prior(map, ex.playerId, ex.seasonId);
    return Math.round(
      ewmaRate(p, (r) => r.gamesPlayed) || p.at(-1)?.gamesPlayed || 40,
    );
  });

  const ewmaTot = holdout.map((ex, i) => {
    const p = prior(map, ex.playerId, ex.seasonId);
    if (stat === "gamesPlayed") return ewmaGp[i];
    const rate = ewmaRate(p, (r) => r[stat]);
    return Math.round(rate * ewmaGp[i]);
  });
  const m2 = evaluateRegression(y, ewmaTot);
  const spear = spearmanCorrelation(y, ewmaTot);

  const lag1gpTot = holdout.map((ex) => {
    const p = prior(map, ex.playerId, ex.seasonId);
    const lagGp = p.at(-1)?.gamesPlayed ?? 40;
    if (stat === "gamesPlayed") return lagGp;
    const rate = ewmaRate(p, (r) => r[stat]);
    return Math.round(rate * lagGp);
  });
  const m3 = evaluateRegression(y, lag1gpTot);

  console.log(
    `${stat}: lag1-total R²=${m1.r2.toFixed(3)} | ewma×ewmaGP R²=${m2.r2.toFixed(3)} ρ=${spear.toFixed(3)} | ewma×lag1GP R²=${m3.r2.toFixed(3)}`,
  );
}

const ysv = holdout.map((ex) => {
  const sv = ex.targetSeason.savePct;
  return sv > 1 ? sv / 100 : sv;
});
const predSv = holdout.map((ex) => {
  const p = prior(map, ex.playerId, ex.seasonId);
  return ewmaRate(p, (r) => (r.savePct > 1 ? r.savePct / 100 : r.savePct)) || 0.905;
});
console.log(`savePct: ewma R²=${evaluateRegression(ysv, predSv).r2.toFixed(3)}`);
