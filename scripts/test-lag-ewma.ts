/**
 * Unit checks for lag EWMA weighting and the skater age curve.
 * Run: npx tsx scripts/test-lag-ewma.ts
 */
import {
  buildTargetInferenceFeatures,
  lagSeasonCount,
} from "../src/lib/ml/features";
import type { PlayerSeasonRow } from "../src/lib/ml/types";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

function season(
  seasonId: number,
  gp: number,
  extra: Record<string, number> = {},
): PlayerSeasonRow {
  return {
    playerId: 1,
    seasonId,
    team: "TOR",
    position: "C",
    isGoalie: false,
    gamesPlayed: gp,
    goals: 20,
    assists: 25,
    shots: 180,
    blocks: 30,
    hits: 40,
    powerplayPoints: 10,
    penaltyMinutes: 25,
    faceoffWins: 300,
    age: 27,
    ...extra,
  } as unknown as PlayerSeasonRow;
}

function featureOf(
  history: PlayerSeasonRow[],
  name: string,
  target: PlayerSeasonRow,
): number {
  const { features, featureNames } = buildTargetInferenceFeatures(
    history,
    "goals",
    false,
    target,
  );
  const i = featureNames.indexOf(name);
  assert(i >= 0, `feature ${name} exists`);
  return i >= 0 ? features[i]! : NaN;
}

// --- season counting ---------------------------------------------------
// Lag vectors pad missing seasons with leading zeros, so the real season
// count cannot be recovered from the values themselves.
assert(lagSeasonCount([]) === 0, "no history → 0 seasons");
assert(lagSeasonCount([season(20232024, 70)]) === 1, "one eligible season");
assert(
  lagSeasonCount([season(20222023, 70), season(20232024, 70)]) === 2,
  "two eligible seasons",
);
assert(
  lagSeasonCount([
    season(20212022, 70),
    season(20222023, 70),
    season(20232024, 70),
    season(20242025, 70),
  ]) === 3,
  "season count caps at the lag window",
);
assert(
  lagSeasonCount([season(20232024, 1), season(20242025, 70)]) === 1,
  "sub-threshold seasons are not eligible",
);

// --- a real zero season must carry its weight --------------------------
// Weights are [0.15, 0.3, 0.55] (most recent last). With two seasons the
// tail [0.3, 0.55] is renormalized, so 30 goals in 70 GP followed by a
// 0-goal season gives (30/70 × 0.3 + 0 × 0.55) / 0.85 ≈ 0.1513.
// Inferring the count from the values dropped the zero season entirely and
// slid the window onto it, yielding exactly 0.
const target = season(20252026, 70);
const zeroLast = featureOf(
  [season(20232024, 70, { goals: 30 }), season(20242025, 70, { goals: 0 })],
  "ewma_goals_pg",
  target,
);
const expected = ((30 / 70) * 0.3 + 0 * 0.55) / 0.85;
assert(
  Math.abs(zeroLast - expected) < 1e-9,
  `real 0-goal season keeps its weight (got ${zeroLast}, want ${expected})`,
);
assert(zeroLast > 0, "a 0-goal recent season must not zero out the EWMA");

// A single season puts all the weight on it — the sanity anchor above it.
const oneSeason = featureOf(
  [season(20242025, 70, { goals: 30 })],
  "ewma_goals_pg",
  target,
);
assert(
  Math.abs(oneSeason - 30 / 70) < 1e-9,
  `one season → its own rate (got ${oneSeason})`,
);
assert(zeroLast < oneSeason, "the zero season pulls the EWMA down");

// --- negative context values must not be dropped -----------------------
const negDiff = featureOf(
  [
    season(20232024, 70, { teamGoalDiffPerGame: 0.5 }),
    season(20242025, 70, { teamGoalDiffPerGame: -0.5 }),
  ],
  "ewma_teamGoalDiffPerGame",
  target,
);
const negExpected = (0.5 * 0.3 + -0.5 * 0.55) / 0.85;
assert(
  Math.abs(negDiff - negExpected) < 1e-9,
  `negative context lags stay weighted (got ${negDiff}, want ${negExpected})`,
);

// --- duplicate lag values ----------------------------------------------
// indexOf-based counting mishandles repeats; equal seasons must average to
// that same value regardless of the weights.
const dup = featureOf(
  [
    season(20232024, 70, { goals: 21 }),
    season(20242025, 70, { goals: 21 }),
  ],
  "ewma_goals_pg",
  target,
);
assert(
  Math.abs(dup - 21 / 70) < 1e-9,
  `two identical seasons average to that rate (got ${dup})`,
);

// --- age curve: the steep 36+ branch must be reachable ------------------
const at34 = featureOf([season(20242025, 70)], "age_curve_mult", season(20252026, 70, { age: 34 }));
const at37 = featureOf([season(20242025, 70)], "age_curve_mult", season(20252026, 70, { age: 37 }));
assert(Math.abs(at34 - 0.91) < 1e-9, `age 34 → 0.91 (got ${at34})`);
assert(Math.abs(at37 - 0.84) < 1e-9, `age 37 → 0.84, not 0.91 (got ${at37})`);
assert(at37 < at34, "decline steepens with age");

// --- shape unchanged ----------------------------------------------------
const built = buildTargetInferenceFeatures(
  [season(20232024, 70), season(20242025, 70)],
  "goals",
  false,
  target,
);
assert(
  built.features.length === built.featureNames.length,
  `features and names stay aligned (${built.features.length} vs ${built.featureNames.length})`,
);
assert(
  built.features.every((v) => Number.isFinite(v)),
  "no NaN/Infinity in the feature vector",
);

if (failed) process.exit(1);
console.log("OK: lag-ewma");
