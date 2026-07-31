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
const activeSum = after
  .filter((p) => p.isGoalie)
  .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
  .slice(0, 3)
  .reduce((s, p) => s + p.gamesPlayed, 0);
assert(activeSum >= 75 && activeSum <= 85, `top-3 sum ~80 (got ${activeSum})`);
assert(after[0]!.gamesPlayed >= 30, `starter keeps real workload (got ${after[0]!.gamesPlayed})`);
assert(after[4]!.gamesPlayed === 4, "org depth fixed at 4 GP");

if (failed) process.exit(1);
console.log("OK: goalie-tandem");
