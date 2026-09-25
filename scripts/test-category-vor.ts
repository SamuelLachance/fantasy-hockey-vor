/**
 * Parameterised category VOR (league profiles): category set, goalie ratio
 * stats by volume, soft cap, flex replacement, goalie weight.
 * Run: npx tsx scripts/test-category-vor.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { join } from "path";
import {
  applyCategoryVor,
  categoryZ,
  computeCategoryScales,
  predictability,
  smoothedShutouts,
  type LeaguePoolPlayer,
} from "../src/lib/leagues/category-vor";
import { draftRounds, parseLeagueProfile } from "../src/lib/leagues/profile";
import type { CategoryLeagueProfile } from "../src/lib/leagues/types";
import type { Position, SkaterProjection } from "../src/lib/types";

const profile: CategoryLeagueProfile = parseLeagueProfile(
  JSON.parse(
    readFileSync(join(process.cwd(), "src/data/leagues/light-the-lamp.json"), "utf8"),
  ),
);

// Profile sanity.
assert.equal(profile.teams, 12);
assert.equal(draftRounds(profile), 18, "14 starters + 4 BN");
assert.deepEqual(profile.categories.skater, [
  "goals",
  "assists",
  "powerplayPoints",
  "shots",
  "hits",
  "blocks",
]);
assert.deepEqual(profile.categories.goalie, [
  "wins",
  "goalsAgainstAverage",
  "savePct",
  "shutouts",
]);
assert.throws(
  () => parseLeagueProfile({ ...profile, categories: { skater: ["goals", "plusMinus"], goalie: [] } }),
  /unknown skater category/,
);
assert.throws(
  () => parseLeagueProfile({ ...profile, draft: { ...profile.draft, rounds: 23 } }),
  /draft.rounds/,
);

// Synthetic pool: 300 skaters (F:D ≈ 2:1) and 60 goalies.
let seed = 11;
const rand = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const POS: Position[] = ["C", "LW", "RW"];
const pool: LeaguePoolPlayer[] = [];
for (let i = 0; i < 300; i++) {
  const isD = i % 3 === 2;
  const tier = 1 - i / 300;
  const pos: Position = isD ? "D" : POS[i % 3]!;
  const positions: Position[] = !isD && rand() < 0.3 ? [pos, POS[(i + 1) % 3]!] : [pos];
  const proj: SkaterProjection = {
    goals: Math.round((isD ? 4 + 10 * tier : 8 + 35 * tier) * (0.8 + 0.4 * rand())),
    assists: Math.round((isD ? 15 + 40 * tier : 15 + 45 * tier) * (0.8 + 0.4 * rand())),
    shots: Math.round((isD ? 90 + 120 * tier : 110 + 180 * tier) * (0.8 + 0.4 * rand())),
    blocks: Math.round((isD ? 70 + 90 * rand() : 15 + 40 * rand())),
    hits: Math.round(20 + 150 * rand()),
    powerplayPoints: Math.round((isD ? 3 + 20 * tier : 3 + 25 * tier) * (0.8 + 0.4 * rand())),
    penaltyMinutes: 999, // not a league category: must not matter
    faceoffWins: 999,
  };
  pool.push({
    id: 1000 + i,
    name: `Skater ${i}`,
    team: "TOR",
    position: pos,
    primaryPosition: pos,
    positions,
    isGoalie: false,
    gamesPlayed: 78,
    projection: proj,
  });
}
for (let i = 0; i < 60; i++) {
  const gp = Math.round(62 - i * 0.8);
  const sv = 0.9 + 0.012 * rand();
  const shots = gp * 27;
  pool.push({
    id: 5000 + i,
    name: `Goalie ${i}`,
    team: "TOR",
    position: "G",
    primaryPosition: "G",
    positions: ["G"],
    isGoalie: true,
    gamesPlayed: gp,
    projection: {
      wins: Math.round(gp * 0.52),
      shutouts: Math.round(gp / 18),
      saves: Math.round(shots * sv),
      savePct: sv,
    },
  });
}

const r2 = {
  goals: 0.75,
  assists: 0.75,
  shots: 0.82,
  blocks: 0.84,
  hits: 0.73,
  powerplayPoints: 0.77,
  wins: -0.19,
  shutouts: -0.1,
  saves: -0.98,
  savePct: -0.7,
};
const res = applyCategoryVor(profile, pool, { r2 });

// Only league categories are scored; PIM/FOW never appear.
for (const p of res.players) {
  const keys = Object.keys(p.z).sort();
  const expected = [...(p.isGoalie ? profile.categories.goalie : profile.categories.skater)].sort();
  assert.deepEqual(keys, expected, `categories of ${p.name}`);
}

// League fill: 12 × 18 drafted, per-slot seats exact, bench = 12 G + 36 skaters.
assert.equal(res.draftedIds.length, 12 * 18);
const seats: Record<string, number> = {};
for (const p of res.players) if (p.modelSlot) seats[p.modelSlot] = (seats[p.modelSlot] ?? 0) + 1;
assert.deepEqual(seats, { C: 24, LW: 24, RW: 24, F: 12, D: 48, Util: 12, G: 24, BN: 48 });
const benchGoalies = res.players.filter((p) => p.modelSlot === "BN" && p.isGoalie).length;
assert.equal(benchGoalies, 12, "one bench goalie per team (4-start minimum)");

// VOR = value − replacement at the chosen position; rank ordering.
for (const p of res.players) {
  const repl = res.replacementLevels[p.vorPosition] ?? 0;
  assert.ok(Math.abs(p.vor - (p.value - repl)) < 1e-9, `vor identity ${p.name}`);
  for (const pos of p.positions) {
    assert.ok(p.vor >= (p.vorByPosition[pos] ?? -Infinity) - 1e-12, "vor is max over slots");
  }
}
for (let i = 1; i < res.players.length; i++) {
  assert.ok(res.players[i - 1]!.vor >= res.players[i]!.vor, "sorted by VOR");
  assert.equal(res.players[i]!.rank, i + 1);
}
// Every drafted player is worth at least his position's waiver replacement.
for (const p of res.players.filter((x) => x.modelSlot != null)) {
  assert.ok(p.vor >= -1e-9, `drafted ${p.name} has VOR ≥ 0 (${p.vor})`);
}
// Flex levels = best undrafted player the slot accepts; a position's
// effective level is at least its own best undrafted player, and exactly a
// flex level when that flex slot seats one of its players.
const rl = res.replacementLevels;
const undraftedSkaters = res.players.filter((p) => p.modelSlot == null && !p.isGoalie);
const bestUndrafted = (ok: (p: (typeof res.players)[number]) => boolean) =>
  Math.max(...undraftedSkaters.filter(ok).map((p) => p.value));
const isFwd = (p: (typeof res.players)[number]) => p.positions.some((x) => x !== "D");
assert.equal(rl.F, bestUndrafted(isFwd));
assert.equal(rl.Util, bestUndrafted(() => true));
for (const pos of ["C", "LW", "RW", "D"] as const) {
  const raw = bestUndrafted((p) => p.positions.includes(pos));
  assert.ok(rl[pos]! >= raw - 1e-12, `${pos} effective ≥ own waiver level`);
  assert.ok(rl[pos]! <= rl.Util! + 1e-12, `${pos} effective ≤ Util level`);
}

// Goalie weight = leverage × predictability, within a sane band.
const gw = res.goalieWeight;
assert.ok(Math.abs(gw.weight - gw.leverageRatio * gw.predictabilityRatio) < 1e-12);
assert.ok(gw.weight > 0.2 && gw.weight < 2, `goalie weight ${gw.weight}`);
assert.ok(gw.predictabilityRatio < 1, "goalie projections trusted less than skater ones");
assert.equal(predictability(null), 1);
assert.equal(predictability(-3), 0.75);
assert.equal(predictability(1), 1);
assert.ok(gw.goalieAppearancesPerWeek >= profile.minGoalieAppearancesPerWeek - 1e-9, "start floor");
const pinned = applyCategoryVor(profile, pool, { r2, goalieWeight: 0.5 });
assert.equal(pinned.goalieWeight.weight, 0.5);
const g0 = pinned.players.find((p) => p.isGoalie)!;
const zSum = Object.values(g0.z).reduce((s, v) => s + (v as number), 0);
assert.ok(Math.abs(g0.value - 0.5 * zSum) < 1e-9, "goalie value = weight × Σz");

// Goalie ratio cats are volume-weighted.
const scales = computeCategoryScales(profile, pool.filter((p) => res.draftedIds.includes(p.id)));
const goalie = (id: number, gp: number, sv: number, shotsPerGame = 27): LeaguePoolPlayer => ({
  id,
  name: `G${id}`,
  team: "TOR",
  position: "G",
  positions: ["G"],
  isGoalie: true,
  gamesPlayed: gp,
  projection: {
    wins: gp / 2,
    shutouts: 2,
    saves: gp * shotsPerGame * sv,
    savePct: sv,
  },
});
const starter = categoryZ(profile, goalie(1, 55, 0.912), scales);
const backup = categoryZ(profile, goalie(2, 20, 0.915), scales);
assert.ok(starter.savePct! > backup.savePct!, "starter's .912 over 55 GP beats a .915 backup over 20");
// GAA: same SV%, fewer shots faced per game → fewer GA per game → better.
const light = categoryZ(profile, goalie(3, 50, 0.905, 24), scales);
const heavy = categoryZ(profile, goalie(4, 50, 0.905, 32), scales);
assert.ok(light.goalsAgainstAverage! > heavy.goalsAgainstAverage!, "GAA rewards facing fewer shots");
// SV% as saves above average: at an above-average rate, more shots faced =
// more team SV% impact.
assert.ok(scales.goalieBaseline.savePct < 0.915, "baseline below .915");
const busyGood = categoryZ(profile, goalie(5, 50, 0.915, 32), scales);
const quietGood = categoryZ(profile, goalie(6, 50, 0.915, 24), scales);
assert.ok(busyGood.savePct! > quietGood.savePct!, "SV% impact scales with workload");

// Soft cap: a 400-hit forward's hits z stays within group offset + 2.75.
const hitsScale = scales.skater.hits!;
const banger: LeaguePoolPlayer = {
  ...pool[0]!,
  id: 99,
  projection: { ...(pool[0]!.projection as SkaterProjection), hits: 400 },
};
const hz = categoryZ(profile, banger, scales).hits!;
const offsetF = (hitsScale.groupMeans.F - hitsScale.mean) / hitsScale.sd;
assert.ok(hz < offsetF + 2.75 && hz > offsetF + 2, `hits soft-capped (${hz})`);
// Goals are not capped.
const sniper: LeaguePoolPlayer = {
  ...pool[0]!,
  id: 98,
  projection: { ...(pool[0]!.projection as SkaterProjection), goals: 90 },
};
const gz = categoryZ(profile, sniper, scales).goals!;
const gs = scales.skater.goals!;
assert.ok(Math.abs(gz - (90 - gs.mean) / gs.sd) < 1e-9, "goals uncapped, common centre");

// Committed data: the real board's shape (no network, deterministic).
const data = JSON.parse(readFileSync(join(process.cwd(), "src/data/players.json"), "utf8"));
const realR2: Record<string, number | null> = {};
for (const g of ["skater", "goalie"]) {
  for (const [k, v] of Object.entries(data.categoryWeights[g] as Record<string, { r2: number | null }>)) {
    realR2[k] = v.r2;
  }
}
const real = applyCategoryVor(
  profile,
  data.players.map((p: LeaguePoolPlayer) => ({ ...p, position: p.primaryPosition ?? p.position })),
  { r2: realR2 },
);
// Flex chains on the real pool: centres sit in F/Util, so a C starter is
// replaced at the F level; no D sits in Util, so D keeps its own level.
const realRl = real.replacementLevels;
assert.ok(
  real.players.some((p) => p.modelSlot === "F" && p.positions.includes("C")),
  "a centre is seated at F",
);
assert.equal(realRl.C, realRl.F, "C replaced at the F level");
assert.ok(!real.players.some((p) => p.modelSlot === "Util" && p.positions.includes("D")), "no D at Util");
const realUndraftedD = real.players.filter((p) => p.modelSlot == null && p.positions.includes("D"));
assert.equal(realRl.D, Math.max(...realUndraftedD.map((p) => p.value)), "D keeps its own level");
// Shutouts are smoothed: same rounded projection, more games at the same
// quality → more (and quality matters at equal games).
const base = { shutoutsPerQualityGame: 0.9 };
const soBusy = smoothedShutouts({ gp: 55, goalsAgainst: 55 * 2.6, shutouts: 2 }, base);
const soLight = smoothedShutouts({ gp: 25, goalsAgainst: 25 * 2.6, shutouts: 2 }, base);
const soGood = smoothedShutouts({ gp: 55, goalsAgainst: 55 * 2.2, shutouts: 2 }, base);
assert.ok(soBusy > soLight && soGood > soBusy, "smoothed SO rises with workload and quality");
assert.equal(smoothedShutouts({ gp: 0, goalsAgainst: 0, shutouts: 1 }, base), 1, "no games → raw");
const realGoalies = real.players.filter((p) => p.isGoalie && p.modelSlot != null);
const soValues = new Set(realGoalies.map((p) => p.stats.shutouts!.toFixed(3)));
assert.ok(soValues.size > realGoalies.length * 0.8, "shutouts no longer collapse onto 1–4");

const top10 = real.players.slice(0, 10);
assert.ok(top10.every((p) => !p.isGoalie), "no goalie in the top 10");
assert.ok(
  top10.some((p) => p.name === "Nathan MacKinnon") && top10.some((p) => p.name === "Connor McDavid"),
  "MacKinnon and McDavid in the top 10",
);
const goalieRanks = real.players.filter((p) => p.isGoalie).map((p) => p.rank);
assert.ok(goalieRanks[0]! > 10 && goalieRanks[0]! < 60, `first goalie mid-early (${goalieRanks[0]})`);
assert.ok(goalieRanks[23]! < 216, "24 starting goalies all go inside the draft");
const again = applyCategoryVor(
  profile,
  data.players.map((p: LeaguePoolPlayer) => ({ ...p, position: p.primaryPosition ?? p.position })),
  { r2: realR2 },
);
assert.deepEqual(
  again.players.slice(0, 50).map((p) => [p.id, p.vor]),
  real.players.slice(0, 50).map((p) => [p.id, p.vor]),
  "deterministic",
);

console.log(
  `OK: category-vor (goalie weight ${real.goalieWeight.weight.toFixed(3)}, first G #${goalieRanks[0]})`,
);
