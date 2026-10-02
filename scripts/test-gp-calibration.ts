/**
 * Unit checks for post-hoc GP calibration (out-of-sample skater curves + goalie
 * tandem split). Run: npx tsx scripts/test-gp-calibration.ts
 */
import {
  CALIBRATED_GP_CEILING,
  calibratedGoalieGp,
  calibratedSkaterGp,
  fitIsotonic,
  fitGroupCurves,
  GP_GROUPS,
  gpCurveFor,
  gpGroupOfPlayer,
  loadGpCalibration,
  type GpOosPair,
  goalieStarterShare,
  modelGp,
  predictIsotonic,
  priorSeasonIdsFor,
  scaleGoalieProjection,
  scaleSkaterProjection,
} from "../src/lib/gp-calibration";
import type { PlayerProfile } from "../src/lib/profile-types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

// --- PAVA ---
const flat = fitIsotonic([
  { x: 1, y: 5, w: 1 },
  { x: 2, y: 3, w: 1 },
  { x: 3, y: 4, w: 1 },
]);
assert(flat.length === 1, "violators pool into one block");
assert(Math.abs(flat[0].y - 4) < 1e-9, "pooled block averages y");

const rising = fitIsotonic([
  { x: 50, y: 55, w: 1 },
  { x: 55, y: 62, w: 1 },
  { x: 60, y: 72, w: 1 },
  { x: 65, y: 78, w: 1 },
]);
assert(rising.length === 4, "monotone data keeps its blocks");
for (let x = 45; x <= 70; x++) {
  const a = predictIsotonic(rising, x);
  const b = predictIsotonic(rising, x + 1);
  assert(b >= a - 1e-9, `prediction monotone at x=${x}`);
}
assert(
  predictIsotonic(rising, 100) <= CALIBRATED_GP_CEILING,
  "extrapolation respects ceiling",
);
assert(predictIsotonic([], 57) === 57, "empty curve is identity");

// --- season ids ---
const [recent, older] = priorSeasonIdsFor("2026-27");
assert(recent === 20252026 && older === 20242025, "prior season ids from 2026-27");

// --- profile helpers ---
function profileWith(
  id: number,
  seasons: Array<{ seasonId: number; gamesPlayed: number; isGoalie?: boolean }>,
): PlayerProfile {
  return {
    id,
    teamHistory: seasons.map((s) => ({
      season: String(s.seasonId),
      seasonId: s.seasonId,
      team: "T",
      gamesPlayed: s.gamesPlayed,
      isGoalie: s.isGoalie ?? false,
      stats: {},
      advanced: {},
    })),
  } as unknown as PlayerProfile;
}

// --- out-of-sample group curves ---
{
  const pairs: GpOosPair[] = [];
  for (let x = 20; x <= 80; x++) {
    // young: next season ~ x − 8 (0 included); vets ~ x
    pairs.push({ group: "youngF", x, y: Math.max(0, x - 8) });
    pairs.push({ group: "vetF", x, y: x });
  }
  const { curves, pairCount } = fitGroupCurves(pairs);
  assert(pairCount.youngF === 61 && pairCount.vetF === 61 && pairCount.vetD === 0, "pairs counted per group");
  assert(Math.abs(predictIsotonic(curves.youngF, 60) - 52) < 1e-9, "young curve maps 60 → 52");
  assert(Math.abs(predictIsotonic(curves.vetF, 60) - 60) < 1e-9, "vet curve maps 60 → 60");
  assert(curves.vetD.length === 0, "no pairs, no curve (model GP kept)");
  const young = { id: 1, team: "T", isGoalie: false, gamesPlayed: 60 };
  const withHistory = profileWith(1, [{ seasonId: 20252026, gamesPlayed: 30 }]);
  assert(
    calibratedSkaterGp(young, withHistory, gpCurveFor({ curves }, { modelSegment: "young", position: "LW" })) === 52,
    "a young forward gets the young-forward curve",
  );
  assert(gpGroupOfPlayer({ modelSegment: "vet", primaryPosition: "D", position: "LW" }) === "vetD", "build position decides D");
  // no NHL history → untouched
  assert(calibratedSkaterGp({ id: 9, team: "T", isGoalie: false, gamesPlayed: 58 }, undefined, curves.youngF) === 58, "no-history player keeps model GP");
  // idempotence: modelGamesPlayed anchors recalibration
  const once = calibratedSkaterGp(young, withHistory, curves.youngF);
  const again = calibratedSkaterGp({ ...young, gamesPlayed: once, modelGamesPlayed: 60 }, withHistory, curves.youngF);
  assert(once === again, `recalibration is idempotent (${once} vs ${again})`);
  assert(modelGp({ id: 1, team: "T", isGoalie: false, gamesPlayed: 70, modelGamesPlayed: 60 }) === 60, "modelGp prefers anchor");
}

// --- the committed calibration (src/data/ml/gp-calibration.json) ---
// Fitted on next-season games out of sample (0 included for players still
// around), not on the board's own past: its walk-forward backtest must stay
// unbiased overall, per model-GP bin and for young players and defensemen.
{
  const cal = loadGpCalibration();
  assert(cal !== null, "src/data/ml/gp-calibration.json present (version 2)");
  if (cal) {
    for (const g of GP_GROUPS) {
      assert(cal.pairCount[g] >= 300, `${g}: ${cal.pairCount[g]} out-of-sample pairs (≥ 300)`);
      const c = cal.curves[g];
      assert(c.length >= 5, `${g}: curve has blocks`);
      for (let i = 1; i < c.length; i++) assert(c[i]!.y >= c[i - 1]!.y - 1e-9, `${g}: curve monotone`);
    }
    // An iron man (model ~75) stays an iron man; a 45-GP model is not 62.
    assert(predictIsotonic(cal.curves.vetF, 75) >= 70, `vetF 75 → ${predictIsotonic(cal.curves.vetF, 75).toFixed(1)} (≥ 70)`);
    assert(predictIsotonic(cal.curves.vetF, 45) < 45, `vetF 45 → ${predictIsotonic(cal.curves.vetF, 45).toFixed(1)} (< 45: zeros included)`);
    type Score = { bias: number; r2: number };
    const bt = cal.backtest as {
      all: Record<string, Score>;
      young: Record<string, Score>;
      defense: Record<string, Score>;
      biasByModelGp: Record<string, Record<string, number>>;
    };
    assert(Math.abs(bt.all.calibrated.bias) <= 1, `walk-forward bias ${bt.all.calibrated.bias} (|·| ≤ 1)`);
    assert(Math.abs(bt.young.calibrated.bias) <= 2, `young bias ${bt.young.calibrated.bias} (|·| ≤ 2)`);
    assert(Math.abs(bt.defense.calibrated.bias) <= 2, `defense bias ${bt.defense.calibrated.bias} (|·| ≤ 2)`);
    assert(bt.all.calibrated.r2 >= bt.all.model.r2, `R² ${bt.all.calibrated.r2} ≥ raw model ${bt.all.model.r2}`);
    assert(bt.all.calibrated.r2 >= 0.31, `R² ${bt.all.calibrated.r2} ≥ 0.31`);
    for (const [bin, b] of Object.entries(bt.biasByModelGp)) {
      assert(Math.abs(b.calibrated) <= 2, `bias in model-GP bin ${bin}: ${b.calibrated} (|·| ≤ 2)`);
    }
  }
}

// --- goalie split ---
assert(Math.abs(goalieStarterShare(45) - 0.55) < 1e-9, "45-start starter share floor");
assert(goalieStarterShare(63) > 0.75, "workhorse share climbs");
assert(goalieStarterShare(90) <= 0.8, "share capped at 0.8");
assert(Math.abs(goalieStarterShare(0) - 0.55) < 1e-9, "no history defaults to floor");

const goalies = [
  { id: 1, team: "WPG", isGoalie: true, gamesPlayed: 50 },
  { id: 2, team: "WPG", isGoalie: true, gamesPlayed: 22 },
  { id: 3, team: "WPG", isGoalie: true, gamesPlayed: 8 },
];
const goalieProfiles = new Map<number, PlayerProfile>([
  [1, profileWith(1, [
    { seasonId: 20252026, gamesPlayed: 60, isGoalie: true },
    { seasonId: 20242025, gamesPlayed: 63, isGoalie: true },
  ])],
  [2, profileWith(2, [{ seasonId: 20252026, gamesPlayed: 20, isGoalie: true }])],
  [3, profileWith(3, [])],
]);
const split = calibratedGoalieGp(goalies, goalieProfiles, "2026-27");
const starter = split.get(1)!;
const backup = split.get(2)!;
const third = split.get(3)!;
assert(starter > 55, `workhorse starter above 55 (got ${starter})`);
assert(starter <= 65, "starter ceiling respected");
assert(backup > third, "backup keeps ordering over third-string");
assert(backup <= starter, "backup never exceeds starter");
assert(third >= 4, "org depth floor");
assert(
  starter + backup + third <= 84,
  `team budget roughly respected (sum ${starter + backup + third})`,
);

// weak starter stays near the 0.55 floor share
const weak = calibratedGoalieGp(
  [
    { id: 4, team: "SJS", isGoalie: true, gamesPlayed: 45 },
    { id: 5, team: "SJS", isGoalie: true, gamesPlayed: 30 },
  ],
  new Map([
    [4, profileWith(4, [{ seasonId: 20252026, gamesPlayed: 41, isGoalie: true }])],
    [5, profileWith(5, [{ seasonId: 20252026, gamesPlayed: 35, isGoalie: true }])],
  ]),
  "2026-27",
);
assert((weak.get(4) ?? 0) <= 46, `1A/1B starter stays modest (got ${weak.get(4)})`);

// --- stat scaling preserves rates ---
const scaled = scaleSkaterProjection(
  {
    goals: 30,
    assists: 40,
    shots: 200,
    blocks: 50,
    hits: 60,
    powerplayPoints: 20,
    penaltyMinutes: 30,
    faceoffWins: 400,
  },
  1.2,
);
assert(scaled.goals === 36 && scaled.shots === 240, "skater totals scale with GP");
const g = scaleGoalieProjection(
  { wins: 25, shutouts: 3, saves: 1200, savePct: 0.915 },
  1.16,
);
assert(g.wins === 29 && g.saves === 1392, "goalie volume scales with GP");
assert(g.savePct === 0.915, "savePct is a rate — untouched");

if (failed) process.exit(1);
console.log("OK: gp-calibration");
