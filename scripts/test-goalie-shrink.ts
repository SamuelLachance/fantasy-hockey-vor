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

// --- The ceilings, recomputed from src/data/moneypuck-goalies.json ----------
// Adjacent-season SV% correlation over goalies with a real workload in both
// years; read as a one-season reliability it bounds how far a projection built
// on three seasons may spread (Spearman-Brown). On RAW SV% the correlation
// also carries the league's SV% drift (every goalie of a high-SV% season
// "persists" into the next one), so the skill figure is the one on SV%
// centred on each season's mean.
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
const ok = (v: MpRow) => v.gamesPlayed >= 25 && v.shotsOnGoalAgainst >= 400;
// Each season's mean SV% over the same workload filter.
const seasonVals = new Map<number, number[]>();
for (const r of rows) if (ok(r)) seasonVals.set(r.seasonId, [...(seasonVals.get(r.seasonId) ?? []), savePct(r)]);
const seasonMean = (sid: number) => {
  const v = seasonVals.get(sid)!;
  return v.reduce((a, b) => a + b, 0) / v.length;
};
const pairs: Array<[MpRow, MpRow]> = [];
for (const r of rows) {
  const start = Number(String(r.seasonId).slice(0, 4)) + 1;
  const next = byKey.get(`${r.playerId}-${start}${start + 1}`);
  if (next && ok(r) && ok(next)) pairs.push([r, next]);
}
assert.ok(pairs.length > 500, `persistence sample (${pairs.length} season pairs)`);
const corr = (x: number[], y: number[]) => {
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
  return sxy / Math.sqrt(sxx * syy);
};
// Three seasons of history (what player-profiles.json holds).
const seasons = 3;
const ceilingOf = (r: number, sdY: number) =>
  ((seasons * r) / (1 + (seasons - 1) * r)) * sdY * Math.sqrt((1 + (seasons - 1) * r) / seasons);
const rawX = pairs.map(([a]) => savePct(a));
const rawY = pairs.map(([, b]) => savePct(b));
const r = corr(rawX, rawY);
const rawCeiling = ceilingOf(r, sd(rawY));
const cX = pairs.map(([a]) => savePct(a) - seasonMean(a.seasonId));
const cY = pairs.map(([, b]) => savePct(b) - seasonMean(b.seasonId));
const rc = corr(cX, cY);
const skillCeiling = ceilingOf(rc, sd(cY));
assert.ok(r > 0.2 && r < 0.45, `raw SV% year-over-year r = ${r.toFixed(3)}`);
assert.ok(rc > 0.08 && rc < 0.22 && rc < r - 0.1, `season-centred r = ${rc.toFixed(3)}: most of the raw r is league drift`);
assert.ok(Math.abs(skillCeiling - 0.0023) < 0.0004, `skill ceiling ${skillCeiling.toFixed(5)} ≈ 0.0023`);
// The shipped constant is the RAW figure, kept as a backtested setting (see
// goalie-shrink.ts): it must stay the raw ceiling, and stay milder than the
// skill one, until the backtest says otherwise.
assert.ok(
  Math.abs(GOALIE_SAVE_PCT_SKILL_SD - rawCeiling) < 0.0004,
  `skill SD constant ${GOALIE_SAVE_PCT_SKILL_SD} ≈ raw-r figure ${rawCeiling.toFixed(5)}`,
);
assert.ok(GOALIE_SAVE_PCT_SKILL_SD > skillCeiling, "the shipped shrink is milder than the skill ceiling");

// --- The shrink on the committed pool ---------------------------------------
const data = JSON.parse(
  readFileSync(join(process.cwd(), "src/data/players.json"), "utf8"),
) as ProjectionsDataset;
const committed: ShrinkablePlayer[] = data.players;
const board = goalieSavePctShrink(committed);
assert.ok(board.count > 20, `reference pool ${board.count} goalies`);
// The projections now shrink save% toward the league themselves
// (src/lib/ml/goalie-v2.ts SAVE_PCT_SPREAD, out-of-sample): the committed
// board sits within the ceiling. The mechanics below run on the same pool
// with its save% gaps widened ×4 when it does.
assert.ok(board.factor >= 1 && board.factor < 2.5, `shrink factor ${board.factor.toFixed(3)}`);
assert.ok(board.spread <= GOALIE_SAVE_PCT_SKILL_SD || board.factor > 1, "board spread within the ceiling, or shrunk to it");
assert.ok(board.mean > 0.885 && board.mean < 0.912, `shrink target ${board.mean.toFixed(5)}`);
const pool: ShrinkablePlayer[] =
  board.factor > 1
    ? committed
    : committed.map((p) => {
        if (!p.isGoalie || !((p.projection as GoalieProjection).savePct > 0)) return p;
        const proj = p.projection as GoalieProjection;
        const shots = impliedShotsAgainst(proj);
        const savePct = board.mean + 4 * (proj.savePct - board.mean);
        return { ...p, projection: { ...proj, savePct, saves: shots * savePct } };
      });
const before = goalieSavePctShrink(pool);
assert.ok(before.factor > 1, `test pool needs shrinking (factor ${before.factor.toFixed(3)})`);

const { players: shrunk, shrink } = shrinkGoalieSavePct(pool);
assert.equal(shrunk.length, pool.length);
const after = goalieSavePctShrink(shrunk);
assert.ok(
  Math.abs(after.spread - GOALIE_SAVE_PCT_SKILL_SD) < 1e-9,
  `spread lands on the ceiling (${after.spread})`,
);
assert.ok(Math.abs(after.mean - before.mean) < 1e-9, "shots-weighted mean preserved");
assert.ok(Math.abs(after.factor - 1) < 1e-9, "nothing left to shrink");

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
  `OK: goalie-shrink (r ${r.toFixed(3)} raw / ${rc.toFixed(3)} season-centred over ${pairs.length} pairs → ceilings ${rawCeiling.toFixed(5)} / ${skillCeiling.toFixed(5)}; pool spread ${before.spread.toFixed(5)} ÷ ${before.factor.toFixed(3)})`,
);
