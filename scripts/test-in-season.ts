/**
 * Rules of the daily in-season update (src/lib/in-season.ts): backtested
 * shrinkage constants, games-share update, default absences, goalie start
 * redistribution and the newcomer prior.
 * Run: npx tsx scripts/test-in-season.ts
 */
import {
  BACKUP_TAKES,
  defaultGamesOut,
  GOALIE_K,
  GOALIE_MAX_SHARE,
  GOALIE_SHARE_K,
  NEWCOMER_PER82,
  redistributeGoalieStarts,
  shrinkRate,
  SKATER_RATE_K,
  SKATER_SHARE_K,
  updatedGameShare,
} from "../src/lib/in-season";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// Backtested constants (2021-26 walk-forward, see src/lib/in-season.ts):
// a future edit must not silently put back the untested ones.
check(
  "skater rate K are the backtested optimum",
  JSON.stringify(SKATER_RATE_K) ===
    JSON.stringify({ goals: 80, assists: 65, powerplayPoints: 50, shots: 28, hits: 20, blocks: 40, penaltyMinutes: 120, faceoffWins: 10 }),
  JSON.stringify(SKATER_RATE_K),
);
check("skater games-share K 30", SKATER_SHARE_K === 30);
check("goalie starts-share K 15-20", GOALIE_SHARE_K >= 15 && GOALIE_SHARE_K <= 20);
check("goalie shots against K 15, shutouts K 100", GOALIE_K.shotsAgainstPerGame === 15 && GOALIE_K.shutouts === 100);
check("goalie SV% K 1500, wins K 30", GOALIE_K.savePctShots === 1500 && GOALIE_K.wins === 30);

// Shrinkage.
check("no games: the prior", near(shrinkRate(0.4, 80, 0, 0), 0.4));
check("K games: halfway", near(shrinkRate(0.2, 20, 20 * 0.6, 20), 0.4));

// Games share: the pre-season share moves toward what he plays.
check("share unchanged when he plays his share", near(updatedGameShare(0.5, 10, 20, 30), 0.5));
const benched = updatedGameShare(0.9, 0, 30, 30);
check("a scratched regular loses share", near(benched, 0.45), String(benched));
check("share never above 1", updatedGameShare(1, 40, 40, 30) <= 1);
check("gp above team games is capped", near(updatedGameShare(0.5, 12, 10, 30), (0.5 * 30 + 10) / 40));

// Default absence without a return date grows with the time already out.
check("DTD 1", defaultGamesOut("Day-To-Day", 0) === 1);
check("fresh IR ~7", defaultGamesOut("Injured Reserve", 1) === 7);
check("IR after 4 games ~10", defaultGamesOut("Injured Reserve", 4) === 10);
check("Out after 10 games ~12", defaultGamesOut("Out", 10) === 12);
check("long absence ~14", defaultGamesOut("Out", 30) === 14);
check("unknown start counts as fresh", defaultGamesOut("Out", null) === 7);

// Goalie redistribution: the n° 2 takes ~60 % of the starter's missing
// starts, the deep goalies the rest by their usual share (not by room).
{
  const left = 70;
  const team = [
    { id: 1, share: 0.65, gamesOut: 10 }, // starter, out 10 games
    { id: 2, share: 0.3, gamesOut: 0 }, // n° 2
    { id: 3, share: 0.04, gamesOut: 0 },
    { id: 4, share: 0.01, gamesOut: 0 },
  ];
  const extra = redistributeGoalieStarts(team, left);
  const missing = 10 * 0.65;
  const total = [...extra.values()].reduce((s, x) => s + x, 0);
  check("n° 2 takes BACKUP_TAKES of the missing starts", near(extra.get(2) ?? 0, BACKUP_TAKES * missing, 1e-9), String(extra.get(2)));
  check("all missing starts handed out", near(total, missing, 1e-9), String(total));
  check("deep goalies by usual share", near((extra.get(3) ?? 0) / (extra.get(4) ?? 1), 4, 1e-9));
  check("n° 2 within the absence window cap", 0.3 * 10 + (extra.get(2) ?? 0) <= GOALIE_MAX_SHARE * 10 + 1e-9);
  check("hurt goalie gets nothing", !extra.has(1));
}
{
  // A day-to-day listing without a game missed is healthy: he can absorb.
  const extra = redistributeGoalieStarts(
    [
      { id: 1, share: 0.6, gamesOut: 5 },
      { id: 2, share: 0.4, gamesOut: 0 },
    ],
    60,
  );
  check("n° 2 capped at 0.8 of the window", (extra.get(2) ?? 0) <= (0.8 - 0.4) * 5 + 1e-9, String(extra.get(2)));
}
check("no healthy goalie: nothing", redistributeGoalieStarts([{ id: 1, share: 0.6, gamesOut: 3 }], 50).size === 0);
check("no games left: nothing", redistributeGoalieStarts([{ id: 1, share: 0.6, gamesOut: 3 }, { id: 2, share: 0.4, gamesOut: 0 }], 0).size === 0);

// Newcomer prior: first NHL season per 82, forwards / defensemen.
check("newcomer forward goals 12.3 / 82", NEWCOMER_PER82.F.goals === 12.3 && NEWCOMER_PER82.F.shots === 113);
check("newcomer D blocks 93 / 82, no faceoffs", NEWCOMER_PER82.D.blocks === 93 && NEWCOMER_PER82.D.faceoffWins === 0);

if (failed > 0) {
  console.error(`${failed} in-season check(s) failed`);
  process.exit(1);
}
console.log("OK: in-season rules");
