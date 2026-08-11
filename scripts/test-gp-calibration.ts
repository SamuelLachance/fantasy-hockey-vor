/**
 * Unit checks for post-hoc GP calibration (isotonic skater curve + goalie
 * tandem split). Run: npx tsx scripts/test-gp-calibration.ts
 */
import {
  CALIBRATED_GP_CEILING,
  calibratedGoalieGp,
  calibratedSkaterGp,
  fitIsotonic,
  fitSkaterGpCurve,
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

// --- skater curve fit end-to-end: bias corrected upward ---
const skaters = Array.from({ length: 40 }, (_, i) => ({
  id: i + 1,
  team: "T",
  isGoalie: false,
  gamesPlayed: 55 + (i % 10), // proj 55..64
}));
const profiles = new Map<number, PlayerProfile>(
  skaters.map((p) => [
    p.id,
    profileWith(p.id, [
      { seasonId: 20252026, gamesPlayed: Math.min(82, p.gamesPlayed + 14) },
      { seasonId: 20242025, gamesPlayed: Math.min(82, p.gamesPlayed + 12) },
    ]),
  ]),
);
const { curve, pairCount } = fitSkaterGpCurve(skaters, profiles, "2026-27");
assert(pairCount === 80, `two pairs per skater (got ${pairCount})`);
const calibrated = calibratedSkaterGp(skaters[0], profiles.get(1), curve);
assert(
  calibrated > skaters[0].gamesPlayed + 8,
  `under-projection corrected upward (55 -> ${calibrated})`,
);

// no NHL history → untouched
const rookie = { id: 999, team: "T", isGoalie: false, gamesPlayed: 58 };
assert(
  calibratedSkaterGp(rookie, undefined, curve) === 58,
  "no-history player keeps model GP",
);

// idempotence: modelGamesPlayed anchors recalibration
const once = calibratedSkaterGp(skaters[0], profiles.get(1), curve);
const again = calibratedSkaterGp(
  { ...skaters[0], gamesPlayed: once, modelGamesPlayed: skaters[0].gamesPlayed },
  profiles.get(1),
  curve,
);
assert(once === again, `recalibration is idempotent (${once} vs ${again})`);
assert(modelGp({ id: 1, team: "T", isGoalie: false, gamesPlayed: 70, modelGamesPlayed: 60 }) === 60, "modelGp prefers anchor");

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
