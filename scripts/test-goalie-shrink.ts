/**
 * Goalie SV% over-dispersion shrink (`src/lib/leagues/goalie-shrink.ts`): the
 * skill-spread ceiling is the one the repo's own persistence data implies, the
 * shrink is mean-preserving, and it moves nothing but SV% and the saves that
 * carry it.
 * Run: npx tsx scripts/test-goalie-shrink.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import { impliedShotsAgainst } from "../src/lib/goalie-impact";
import {
  GOALIE_SAVE_PCT_SKILL_SD,
  GOALIE_SHRINK_MIN_GP,
  goalieSavePctShrink,
  shrinkGoalieSavePct,
  type ShrinkablePlayer,
} from "../src/lib/leagues/goalie-shrink";
import type { GoalieProjection, ProjectionsDataset } from "../src/lib/types";

const sd = (v: number[]) => {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
};

// --- The ceiling, recomputed from src/data/moneypuck-goalies.json ------------
// Adjacent-season SV% correlation over goalies with a real workload in both
// years; read as a one-season reliability it bounds how far a projection built
// on three seasons may spread (Spearman-Brown).
interface MpRow {
  playerId: number;
  seasonId: number;
  gamesPlayed: number;
  goalsAgainst: number;
  shotsOnGoalAgainst: number;
}
const mp = JSON.parse(
  readFileSync(join(process.cwd(), "src/data/moneypuck-goalies.json"), "utf8"),
) as { byKey: Record<string, MpRow> };
const rows = Object.values(mp.byKey);
const byKey = new Map(rows.map((r) => [`${r.playerId}-${r.seasonId}`, r]));
const savePct = (r: MpRow) => 1 - r.goalsAgainst / r.shotsOnGoalAgainst;
const x: number[] = [];
const y: number[] = [];
for (const r of rows) {
  const start = Number(String(r.seasonId).slice(0, 4)) + 1;
  const next = byKey.get(`${r.playerId}-${start}${start + 1}`);
  if (!next) continue;
  const ok = (v: MpRow) => v.gamesPlayed >= 25 && v.shotsOnGoalAgainst >= 400;
  if (!ok(r) || !ok(next)) continue;
  x.push(savePct(r));
  y.push(savePct(next));
}
assert.ok(x.length > 500, `persistence sample (${x.length} season pairs)`);
const mx = x.reduce((a, b) => a + b, 0) / x.length;
const my = y.reduce((a, b) => a + b, 0) / y.length;
let sxy = 0;
let sxx = 0;
let syy = 0;
for (let i = 0; i < x.length; i++) {
  sxy += (x[i]! - mx) * (y[i]! - my);
  sxx += (x[i]! - mx) ** 2;
  syy += (y[i]! - my) ** 2;
}
const r = sxy / Math.sqrt(sxx * syy);
const sdObserved = sd(y);
assert.ok(r > 0.2 && r < 0.45, `SV% year-over-year r = ${r.toFixed(3)}`);
// Three seasons of history (what player-profiles.json holds).
const seasons = 3;
const reliability = (seasons * r) / (1 + (seasons - 1) * r);
const ceiling = reliability * sdObserved * Math.sqrt((1 + (seasons - 1) * r) / seasons);
assert.ok(
  Math.abs(GOALIE_SAVE_PCT_SKILL_SD - ceiling) < 0.0004,
  `skill SD constant ${GOALIE_SAVE_PCT_SKILL_SD} ≈ derived ${ceiling.toFixed(5)}`,
);
// Bounds either side of it: one season is tighter, unlimited history looser.
assert.ok(r * sdObserved < GOALIE_SAVE_PCT_SKILL_SD, "one-season figure is tighter");
assert.ok(Math.sqrt(r) * sdObserved > GOALIE_SAVE_PCT_SKILL_SD, "unlimited-history ceiling is looser");

// --- The shrink on the committed pool ---------------------------------------
const data = JSON.parse(
  readFileSync(join(process.cwd(), "src/data/players.json"), "utf8"),
) as ProjectionsDataset;
const pool: ShrinkablePlayer[] = data.players;
const before = goalieSavePctShrink(pool);
assert.ok(before.count > 20, `reference pool ${before.count} goalies`);
assert.ok(before.factor > 1.3 && before.factor < 2.5, `shrink factor ${before.factor.toFixed(3)}`);
assert.ok(before.mean > 0.895 && before.mean < 0.912, `shrink target ${before.mean.toFixed(5)}`);

const { players: shrunk, shrink } = shrinkGoalieSavePct(pool);
assert.equal(shrunk.length, pool.length);
const after = goalieSavePctShrink(shrunk);
assert.ok(
  Math.abs(after.spread - GOALIE_SAVE_PCT_SKILL_SD) < 1e-9,
  `spread lands on the ceiling (${after.spread})`,
);
assert.ok(Math.abs(after.mean - before.mean) < 1e-9, "shots-weighted mean preserved");
assert.equal(after.factor, 1, "nothing left to shrink");

const refIndexes = pool
  .map((p, i) => i)
  .filter((i) => pool[i]!.isGoalie && pool[i]!.gamesPlayed >= GOALIE_SHRINK_MIN_GP);
assert.ok(refIndexes.length === before.count);
for (let i = 0; i < pool.length; i++) {
  const a = pool[i]!;
  const b = shrunk[i]!;
  assert.equal(b.gamesPlayed, a.gamesPlayed, "GP untouched");
  if (!a.isGoalie) {
    assert.equal(b.projection, a.projection, "skaters untouched");
    continue;
  }
  const pa = a.projection as GoalieProjection;
  const pb = b.projection as GoalieProjection;
  assert.equal(pb.wins, pa.wins, "wins untouched");
  assert.equal(pb.shutouts, pa.shutouts, "shutouts untouched");
  if (!(pa.savePct > 0)) continue;
  assert.ok(
    Math.abs(impliedShotsAgainst(pb) - impliedShotsAgainst(pa)) < 1e-6,
    "shots against untouched",
  );
  // Every goalie moves toward the mean, nobody past it.
  const da = pa.savePct - shrink.mean;
  const db = pb.savePct - shrink.mean;
  assert.ok(Math.abs(db) <= Math.abs(da) + 1e-12 && da * db >= 0, "shrunk toward the mean");
  assert.ok(Math.abs(db * shrink.factor - da) < 1e-12, "shrunk by exactly the factor");
}

// A pool already inside the ceiling is left alone.
const tight: ShrinkablePlayer[] = Array.from({ length: 30 }, (_, i) => ({
  isGoalie: true,
  gamesPlayed: 50,
  projection: { wins: 25, shutouts: 3, saves: 50 * 28 * (0.903 + i * 0.0001), savePct: 0.903 + i * 0.0001 },
}));
const tightShrink = shrinkGoalieSavePct(tight);
assert.equal(tightShrink.shrink.factor, 1);
assert.deepEqual(tightShrink.players, tight, "no change when the spread is justified");

console.log(
  `OK: goalie-shrink (r ${r.toFixed(3)} over ${x.length} pairs → ceiling ${ceiling.toFixed(5)}; pool spread ${before.spread.toFixed(5)} ÷ ${before.factor.toFixed(3)})`,
);
