/**
 * Unit check: overloaded team goalie GP pools are scaled to budget.
 * Run: npx tsx scripts/test-goalie-tandem.ts
 */
import {
  findOverloadedGoalieTeams,
  findUnderloadedGoalieTeams,
  top3GoalieGpSum,
  topGoalieGpTooLow,
} from "../src/lib/goalie-tandem-guards";
import {
  GOALIE_GP_CEILING,
  GOALIE_LOW_EVIDENCE_WEIGHT,
  GOALIE_TEAM_GAMES,
  renormalizeGoalieGamesByTeam,
} from "../src/lib/ml/goalie-v2";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

const before = [
  { team: "PHI", gamesPlayed: 45, isGoalie: true },
  { team: "PHI", gamesPlayed: 40, isGoalie: true },
  { team: "PHI", gamesPlayed: 35, isGoalie: true },
  { team: "PHI", gamesPlayed: 30, isGoalie: true },
  { team: "PHI", gamesPlayed: 25, isGoalie: true },
  { team: "EDM", gamesPlayed: 55, isGoalie: false },
];
const sumBefore = before
  .filter((p) => p.isGoalie)
  .reduce((s, p) => s + p.gamesPlayed, 0);
assert(sumBefore > 150, "fixture overloaded");

const after = renormalizeGoalieGamesByTeam(before, 80);
const activeSum = after
  .filter((p) => p.isGoalie)
  .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  .slice(0, 3)
  .reduce((s, p) => s + p.gamesPlayed, 0);
assert(activeSum >= 75 && activeSum <= 85, `top-3 sum ~80 (got ${activeSum})`);
assert(after[0]!.gamesPlayed >= 30, `starter keeps real workload (got ${after[0]!.gamesPlayed})`);
assert(after[4]!.gamesPlayed === 4, "org depth fixed at 4 GP");

const clear = renormalizeGoalieGamesByTeam(
  [
    { team: "WPG", gamesPlayed: 60, isGoalie: true },
    { team: "WPG", gamesPlayed: 40, isGoalie: true },
    { team: "WPG", gamesPlayed: 10, isGoalie: true },
  ],
  80,
);
assert(clear[0]!.gamesPlayed >= 48, `clear starter gets ≥48 (got ${clear[0]!.gamesPlayed})`);
assert(clear[1]!.gamesPlayed <= 28, `backup capped (got ${clear[1]!.gamesPlayed})`);

// Regression (2026-10-02 board): a starter next to a former starter and a
// prospect lost the whole excess under the old pro-rata rule (Hellebuyck 55
// model games, Skinner 41, DiVincentiis 15 → 37 published).
const wpg = renormalizeGoalieGamesByTeam([
  { team: "WPG", gamesPlayed: 55, isGoalie: true },
  { team: "WPG", gamesPlayed: 41, isGoalie: true },
  { team: "WPG", gamesPlayed: 15, isGoalie: true },
  { team: "WPG", gamesPlayed: 8, isGoalie: true },
]);
assert(wpg[0]!.gamesPlayed >= 47 && wpg[0]!.gamesPlayed <= 55, `starter beside a former starter keeps most of his games (got ${wpg[0]!.gamesPlayed})`);
assert(wpg[1]!.gamesPlayed < wpg[0]!.gamesPlayed && wpg[1]!.gamesPlayed >= 18, `backup gets the rest (got ${wpg[1]!.gamesPlayed})`);
const wpgSum = wpg.slice(0, 3).reduce((s, p) => s + p.gamesPlayed, 0);
assert(Math.abs(wpgSum - GOALIE_TEAM_GAMES) <= 2, `top three share the club's ${GOALIE_TEAM_GAMES} games (got ${wpgSum})`);
assert(wpg[3]!.gamesPlayed === 4, "org depth at 4 GP");
// An empty crease (two goalies without an NHL season) gives the starter part of the slack.
const uta = renormalizeGoalieGamesByTeam([
  { team: "UTA", gamesPlayed: 49, isGoalie: true },
  { team: "UTA", gamesPlayed: 8, isGoalie: true },
  { team: "UTA", gamesPlayed: 8, isGoalie: true },
]);
assert(uta[0]!.gamesPlayed > 49 && uta[0]!.gamesPlayed <= GOALIE_GP_CEILING, `starter of an empty crease gains (got ${uta[0]!.gamesPlayed})`);
// Regression (2026-10-02 board): a third goalie with little recent NHL
// evidence (Matt Murray, 31 model games after 7 NHL games in two seasons)
// weighs GOALIE_LOW_EVIDENCE_WEIGHT, not his model games.
const seaRoster = [
  { team: "SEA", gamesPlayed: 45, isGoalie: true, recentNhlGames: 104 },
  { team: "SEA", gamesPlayed: 34, isGoalie: true, recentNhlGames: 58 },
  { team: "SEA", gamesPlayed: 31, isGoalie: true, recentNhlGames: 7 },
  { team: "SEA", gamesPlayed: 8, isGoalie: true, recentNhlGames: 1 },
];
const sea = renormalizeGoalieGamesByTeam(seaRoster);
const seaUncapped = renormalizeGoalieGamesByTeam(seaRoster.map(({ recentNhlGames: _r, ...p }) => (void _r, p)));
assert(sea[0]!.gamesPlayed >= 44 && sea[0]!.gamesPlayed > seaUncapped[0]!.gamesPlayed, `starter not crowded out by a low-evidence third (got ${sea[0]!.gamesPlayed}, ${seaUncapped[0]!.gamesPlayed} uncapped)`);
assert(sea[2]!.gamesPlayed <= GOALIE_LOW_EVIDENCE_WEIGHT && sea[1]!.gamesPlayed > 25, `low-evidence third at most his weight, backup the rest (got ${sea[1]!.gamesPlayed} / ${sea[2]!.gamesPlayed})`);
// A low-evidence starter (the most model games) keeps his model games as his weight.
const fresh = renormalizeGoalieGamesByTeam([
  { team: "X", gamesPlayed: 40, isGoalie: true, recentNhlGames: 0 },
  { team: "X", gamesPlayed: 30, isGoalie: true, recentNhlGames: 60 },
]);
assert(fresh[0]!.gamesPlayed >= 40, `low-evidence starter keeps his model games (got ${fresh[0]!.gamesPlayed})`);
// An evidenced third outranks a low-evidence one with more model games.
const ana = renormalizeGoalieGamesByTeam([
  { team: "ANA", gamesPlayed: 47, isGoalie: true, recentNhlGames: 110 },
  { team: "ANA", gamesPlayed: 31, isGoalie: true, recentNhlGames: 1 },
  { team: "ANA", gamesPlayed: 24, isGoalie: true, recentNhlGames: 33 },
  { team: "ANA", gamesPlayed: 21, isGoalie: true, recentNhlGames: 48 },
]);
assert(ana[0]!.gamesPlayed >= 45 && ana[1]!.gamesPlayed === 4 && ana[3]!.gamesPlayed > 4, `Dostal / Brossoit / Mrazek (got ${ana.map((p) => p.gamesPlayed).join(" ")})`);
// Monotone: a crowded crease never lifts the starter, an emptier one never cuts him.
for (const other of [10, 20, 30, 40, 50, 60]) {
  const a = renormalizeGoalieGamesByTeam([
    { team: "X", gamesPlayed: 60, isGoalie: true },
    { team: "X", gamesPlayed: other, isGoalie: true },
  ]);
  const b = renormalizeGoalieGamesByTeam([
    { team: "X", gamesPlayed: 60, isGoalie: true },
    { team: "X", gamesPlayed: other + 10, isGoalie: true },
  ]);
  assert(b[0]!.gamesPlayed <= a[0]!.gamesPlayed, `starter GP monotone in his backup's (${other})`);
  assert(a[0]!.gamesPlayed >= a[1]!.gamesPlayed, "starter stays ahead");
}

assert(top3GoalieGpSum([50, 22, 8, 4]) === 80, "top3 sums three largest");
assert(topGoalieGpTooLow(39), "39 GP fails top-goalie floor");
assert(!topGoalieGpTooLow(40), "40 GP passes top-goalie floor");
const byTeam = new Map<string, number[]>([
  ["PHI", [45, 40, 35]],
  ["ANA", [20, 15]],
]);
assert(
  findOverloadedGoalieTeams(byTeam).some((s) => s.startsWith("PHI=")),
  "PHI flagged overloaded",
);
assert(
  findUnderloadedGoalieTeams(byTeam).some((s) => s.startsWith("ANA=")),
  "ANA flagged underloaded",
);

if (failed) process.exit(1);
console.log("OK: goalie-tandem");
