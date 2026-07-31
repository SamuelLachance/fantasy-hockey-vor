/**
 * Unit check: overloaded team goalie GP pools are scaled to budget.
 * Run: npx tsx scripts/test-goalie-tandem.ts
 */
import { renormalizeGoalieGamesByTeam } from "../src/lib/ml/goalie-v2";

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
const sumAfter = after
  .filter((p) => p.isGoalie)
  .reduce((s, p) => s + p.gamesPlayed, 0);
assert(sumAfter >= 75 && sumAfter <= 85, `sum ~80 (got ${sumAfter})`);
assert(
  after[0]!.gamesPlayed >= after[4]!.gamesPlayed,
  "relative order preserved",
);

if (failed) process.exit(1);
console.log("OK: goalie-tandem");
