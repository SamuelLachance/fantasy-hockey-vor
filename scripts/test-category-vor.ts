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
  CATEGORY_OVERDISPERSION,
  categoryZ,
  GOALIE_WEIGHT_CALIBRATION,
  computeCategoryScales,
  predictability,
  smoothedShutouts,
  type LeaguePoolPlayer,
} from "../src/lib/leagues/category-vor";
import { draftRounds, parseLeagueProfile } from "../src/lib/leagues/profile";
import type { CategoryLeagueProfile, StartingSlot } from "../src/lib/leagues/types";
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

// Flex seats read their own eligibility, never a hard-coded forward list: a
// profile whose Util does not accept D must not be priced at the best
// undrafted defenseman.
const noDUtil: CategoryLeagueProfile = {
  ...profile,
  slotEligibility: { ...profile.slotEligibility, Util: ["C", "LW", "RW"] },
};
const forwardUtil = applyCategoryVor(noDUtil, pool, { r2 });
const undraftedOf = (r: typeof forwardUtil, ok: (p: (typeof r.players)[number]) => boolean) =>
  Math.max(...r.players.filter((p) => p.modelSlot == null && ok(p)).map((p) => p.value));
assert.equal(
  forwardUtil.replacementLevels.Util,
  undraftedOf(forwardUtil, (p) => p.positions.some((x) => x !== "D" && x !== "G")),
  "Util level = best undrafted player the seat accepts",
);
assert.ok(
  forwardUtil.replacementLevels.Util !== undraftedOf(forwardUtil, (p) => p.positions.includes("D")),
  "a forward-only Util is not priced at the best undrafted D",
);

// Per-seat baselines must not depend on which slot the fill happens to pick
// for a multi-eligible player: seats that draw on the same group share a line,
// and the seats-weighted sum still equals the league-average team's total.
const avg = res.averageTeam;
const sumZ = (slot: StartingSlot) =>
  profile.categories.skater.reduce((s, c) => s + (avg.slotZ[slot]?.[c] ?? 0), 0);
const forwardSeatSlots: StartingSlot[] = ["C", "LW", "RW", "F"];
for (const slot of forwardSeatSlots) {
  assert.ok(
    Math.abs(sumZ(slot) - sumZ("C")) < 1e-9,
    `${slot} shares the forward-seat baseline (${sumZ(slot)} vs ${sumZ("C")})`,
  );
}
assert.ok(sumZ("D") < sumZ("C") - 0.5, "D keeps its own baseline");
for (const cat of profile.categories.skater) {
  const seatSum = (["C", "LW", "RW", "F", "D", "Util"] as StartingSlot[]).reduce(
    (s, slot) => s + (profile.roster[slot] ?? 0) * (avg.slotZ[slot]?.[cat] ?? 0),
    0,
  );
  assert.ok(
    Math.abs(seatSum - (avg.zTotals[cat] ?? 0)) < 1e-9,
    `${cat}: seats × baseline = league-average team total`,
  );
}

// Goalie weight = leverage × predictability, within a sane band.
const gw = res.goalieWeight;
// Wins is binomial over the team's goalie appearances, not Poisson: the trial
// is a coin flip and the appearance count is managed to the league minimum.
const gStarters = res.players.filter((p) => p.modelSlot === "G");
const teamGp = gStarters.reduce((s, p) => s + p.gamesPlayed, 0) / profile.teams;
const floorGp = profile.minGoalieAppearancesPerWeek * profile.matchupWeeks;
const appearances = Math.max(teamGp, floorGp);
const teamWins =
  (gStarters.reduce((s, p) => s + (p.stats.wins ?? 0), 0) / profile.teams) *
  Math.max(1, floorGp / teamGp);
const winRate = teamWins / appearances;
const winSd = computeCategoryScales(profile, pool.filter((p) => res.draftedIds.includes(p.id))).goalie
  .wins!.sd;
assert.ok(
  Math.abs(gw.leverage.wins! - winSd / Math.sqrt(appearances * winRate * (1 - winRate))) < 1e-9,
  "wins leverage uses a binomial appearance count",
);
assert.ok(
  gw.leverage.wins! > winSd / Math.sqrt(teamWins),
  "…which is above what a Poisson count would give",
);
assert.ok(Math.abs(gw.weight - gw.leverageRatio * gw.predictabilityRatio * gw.calibration) < 1e-12);
assert.equal(gw.calibration, GOALIE_WEIGHT_CALIBRATION, "the backtest-validated calibration is applied");
// Over-dispersion: each category's noise variance is × φ², so its leverage ÷ φ.
const poisson = applyCategoryVor(profile, pool, { r2, overdispersion: {} }).goalieWeight;
for (const cat of ["shots", "hits", "blocks", "goals", "shutouts"] as const) {
  assert.ok(
    Math.abs(poisson.leverage[cat]! / gw.leverage[cat]! - CATEGORY_OVERDISPERSION[cat]!) < 1e-9,
    `${cat}: leverage ÷ φ (${CATEGORY_OVERDISPERSION[cat]})`,
  );
}
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

// ---- the SV% shrink composes SV% / GAA; it no longer sets the exchange rate
// (CAT-2 / CAT-3). Before, the shrink constant alone moved the 2026-27 weight
// from 0.51 (0.0023) to 0.59 (0.0051) to 0.81 (none): the leverage was read
// off the shrunk spread while the predictability ratio discounted the same
// weak goalie projections again.
const realPool = data.players.map((p: LeaguePoolPlayer) => ({ ...p, position: p.primaryPosition ?? p.position }));
const weightAt = (opts: Parameters<typeof applyCategoryVor>[2]) => applyCategoryVor(profile, realPool, { r2: realR2, ...opts }).goalieWeight.weight;
const wTight = weightAt({ savePctSkillSd: 0.0023 });
const wNone = weightAt({ savePctSkillSd: null });
const wShipped = real.goalieWeight.weight;
assert.ok(
  Math.abs(wTight - wShipped) / wShipped < 0.03 && Math.abs(wNone - wShipped) / wShipped < 0.08,
  `goalie weight barely moves with the shrink constant (${wTight.toFixed(3)} / ${wShipped.toFixed(3)} / ${wNone.toFixed(3)})`,
);
const coupled = (sd: number | null) =>
  weightAt({ savePctSkillSd: sd, goalieLeverageOnShrunk: true, overdispersion: {}, goalieWeightCalibration: 1 });
assert.ok(coupled(null) / coupled(0.0023) > 1.4, "…where the old coupling moved it by half (kept as a backtest option only)");

// ---- φ re-measured on the committed weekly team totals (CAT-1)
// Two-factor residual (week + team effects removed: what survives into
// A − B), divided by the Poisson SD (binomial at the realized appearance count
// for wins), averaged over the five seasons of the fixture.
{
  const fx = JSON.parse(readFileSync(join(process.cwd(), "scripts/fixtures/category-weekly-totals.json"), "utf8")) as {
    seasons: Record<string, Record<string, number[][]>>;
  };
  const phi: Record<string, number[]> = {};
  for (const series of Object.values(fx.seasons)) {
    for (const cat of [...profile.categories.skater, "wins", "shutouts"]) {
      const X = series[cat]!;
      const W = X.length;
      const T = X[0]!.length;
      const mu = X.flat().reduce((a, b) => a + b, 0) / (W * T);
      const teamMean = Array.from({ length: T }, (_, t) => X.reduce((s, r) => s + r[t]!, 0) / W);
      const weekMean = X.map((r) => r.reduce((a, b) => a + b, 0) / T);
      let ss = 0;
      for (let w = 0; w < W; w++) for (let t = 0; t < T; t++) ss += (X[w]![t]! - teamMean[t]! - weekMean[w]! + mu) ** 2;
      const sd = Math.sqrt(ss / ((T - 1) * (W - 1)));
      let model = mu;
      if (cat === "wins") {
        const gp = series.goalieGp!.flat().reduce((a, b) => a + b, 0) / (W * T);
        const p = mu / gp;
        model = gp * p * (1 - p);
      }
      (phi[cat] ??= []).push(sd / Math.sqrt(model));
    }
  }
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.equal(Object.values(fx.seasons).length, 5, "five seasons of weekly totals");
  for (const cat of [...profile.categories.skater, "shutouts"] as const) {
    const measured = avg(phi[cat]!);
    assert.ok(
      Math.abs(measured - CATEGORY_OVERDISPERSION[cat]!) <= 0.03,
      `φ ${cat}: engine ${CATEGORY_OVERDISPERSION[cat]} vs measured ${measured.toFixed(3)}`,
    );
  }
  // Wins: measured with the appearance count left random; the engine treats
  // it as managed (streamed to the weekly minimum) and keeps 1.
  const wins = avg(phi.wins!);
  assert.ok(wins > 1.15 && wins < 1.35 && CATEGORY_OVERDISPERSION.wins === 1, `φ wins: ${wins.toFixed(3)} random, 1 managed`);
}

console.log(
  `OK: category-vor (goalie weight ${real.goalieWeight.weight.toFixed(3)}, first G #${goalieRanks[0]})`,
);
