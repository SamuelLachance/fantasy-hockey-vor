/**
 * Rules of the daily in-season update (src/lib/in-season.ts,
 * src/lib/inseason/*): backtested shrinkage constants, games-share update,
 * default absences, goalie start redistribution, the newcomer prior, the
 * usage-aware rates (ice time, PP time, shooting %), and the guard of the
 * day-by-day backtests (src/data/ml/in-season-*backtest.json): run with the
 * constants in the code, and the new update no worse than the one it
 * replaced at every checkpoint and in every season left out.
 * Run: npx tsx scripts/test-in-season.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { GOALIE_RULES } from "../src/lib/inseason/goalie";
import { scoreFixture, type Fixture } from "./in-season-fixture";
import { gamesFromRows, playedFlags, priorUsageOf, trimCurrentAbsence } from "../src/lib/inseason/live";
import { NEWCOMER_RATE_LINES, NEWCOMER_SHARE_LINES, NEWCOMER_USAGE_K, newcomerRates, newcomerShare } from "../src/lib/inseason/newcomer";
import {
  gamesShareNow,
  recencyMean,
  restOfSeasonRates,
  SHARE_HALF_LIFE,
  SHARE_K,
  SHARE_SKIP_ABSENCE,
  SHARE_TOI_ELASTICITY,
  SHOOTING_K,
  STAT_RULES,
  USAGE_PARAMS,
  usageNow,
  withoutCompletedAbsences,
} from "../src/lib/inseason/skater";
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

// ---- usage-aware skater rates (src/lib/inseason/skater.ts)
check("recency mean: no games, the prior", near(recencyMean(15, [], 3, 10), 15));
check("recency mean: flat weights", near(recencyMean(10, [20, 20], 2, 0), 15));
check("recency mean: last game weighs most", recencyMean(0, [10, 20], 0, 1) > 15);
{
  const same = usageNow({ toiPrior: 18, ppPrior: 3, toi: [18, 18, 18], pp: [3, 3, 3] });
  check("same role: ratios 1", near(same.toiRatio, 1) && near(same.ppRatio, 1));
  const promoted = usageNow({ toiPrior: 14, ppPrior: 0.5, toi: [19, 19, 19, 19, 19, 19], pp: [3.5, 3.5, 3.5, 3.5, 3.5, 3.5] });
  check("promoted: ratios above 1", promoted.toiRatio > 1.2 && promoted.ppRatio >= 2, JSON.stringify(promoted));
  check("ratios bounded", promoted.ppRatio <= USAGE_PARAMS.ratioMax && usageNow({ toiPrior: 20, ppPrior: 4, toi: [2], pp: [0] }).toiRatio >= USAGE_PARAMS.ratioMin);
  const unknown = usageNow({ toiPrior: null, ppPrior: null, toi: [15], pp: [1] });
  check("no prior ice time: ratios 1", unknown.toiRatio === 1 && unknown.ppRatio === 1 && near(unknown.toi ?? 0, 15));
  const prior = { goals: 0.3, assists: 0.4, powerplayPoints: 0.2, shots: 2.5, hits: 1, blocks: 0.5, penaltyMinutes: 0.4, faceoffWins: 5 };
  const zero = { goals: 0, assists: 0, powerplayPoints: 0, shots: 0, hits: 0, blocks: 0, penaltyMinutes: 0, faceoffWins: 0 };
  const r0 = restOfSeasonRates({ prior, totals: zero, gp: 0, usage: same });
  check("no games, same role: the prior (goals = shots × prior shooting %)", Object.entries(prior).every(([k, v]) => near(r0[k as keyof typeof r0], v, 1e-12)), JSON.stringify(r0));
  const up = restOfSeasonRates({ prior, totals: zero, gp: 0, usage: promoted });
  check("promotion raises goals, assists, PPP, shots", up.goals > prior.goals && up.assists > prior.assists && up.powerplayPoints > prior.powerplayPoints && up.shots > prior.shots);
  check("penalty minutes barely move with the role", Math.abs(up.penaltyMinutes / prior.penaltyMinutes - 1) < 0.1);
  // A hot shooter: 10 goals on 40 shots in 10 games.
  const hot = restOfSeasonRates({ prior, totals: { ...zero, goals: 10, shots: 40 }, gp: 10, usage: same });
  const pct = (0.12 * SHOOTING_K + 10) / (SHOOTING_K + 40);
  check("goals = shots rate × regressed shooting %", near(hot.goals, hot.shots * pct, 1e-12), `${hot.goals} vs ${hot.shots * pct}`);
  check("shooting luck is mostly regressed", hot.goals < 0.4 && hot.goals > prior.goals);
}
check("completed long absence left out", JSON.stringify(withoutCompletedAbsences([true, false, false, false, true, true], 3)) === JSON.stringify([true, true, true]));
check("short absence kept", JSON.stringify(withoutCompletedAbsences([true, false, true], 3)) === JSON.stringify([true, false, true]));
check("current absence kept", JSON.stringify(withoutCompletedAbsences([true, true, false, false, false], 3)) === JSON.stringify([true, true, false, false, false]));
check("games before his first one kept", JSON.stringify(withoutCompletedAbsences([false, false, false, true], 3)) === JSON.stringify([false, false, false, true]));
{
  const u1 = usageNow({ toiPrior: 15, ppPrior: 1, toi: [15], pp: [1] });
  const all = Array.from({ length: 20 }, () => true);
  check("ever-present regular keeps a high share", gamesShareNow(0.9, all, u1) > 0.9);
  const scratched = [...Array.from({ length: 15 }, () => true), false, false, false, false, false];
  check("recent scratches cut the share more than old ones", gamesShareNow(0.8, scratched, u1) < gamesShareNow(0.8, [false, false, true, true, true, ...Array.from({ length: 15 }, () => true)], u1));
  const cut = usageNow({ toiPrior: 15, ppPrior: 1, toi: [9, 9, 9, 9, 9], pp: [0, 0, 0, 0, 0] });
  check("a role cut lowers the share", gamesShareNow(0.8, all, cut) < gamesShareNow(0.8, all, u1));
  check("share within [0, 1]", gamesShareNow(1, all, usageNow({ toiPrior: 10, ppPrior: 0, toi: [25, 25, 25, 25], pp: [5, 5, 5, 5] })) <= 1);
}

// ---- live plumbing (src/lib/inseason/live.ts)
{
  const rows = [
    { playerId: 1, gameId: 11, gameDate: "2026-10-01", teamAbbrev: "MTL", timeOnIce: 1200, ppTimeOnIce: 120 },
    { playerId: 1, gameId: 12, gameDate: "2026-10-03", teamAbbrev: "MTL", timeOnIce: 1080, ppTimeOnIce: 0 },
    { playerId: 2, gameId: 11, gameDate: "2026-10-01", teamAbbrev: "MTL", timeOnIce: 600, ppTimeOnIce: 0 },
    { playerId: 2, gameId: 11, gameDate: "2026-10-01", teamAbbrev: "MTL", timeOnIce: 600, ppTimeOnIce: 0 },
    { playerId: 3, gameId: 13, gameDate: "2026-10-02", teamAbbrev: "TOR", timeOnIce: 900, ppTimeOnIce: 60 },
  ];
  const { byPlayer, teamGames } = gamesFromRows(rows);
  check("rows → minutes, oldest first", near(byPlayer.get(1)![0]!.toi, 20) && near(byPlayer.get(1)![0]!.pp, 2) && byPlayer.get(1)![1]!.gameId === 12);
  check("duplicate rows dropped", byPlayer.get(2)!.length === 1);
  check("team games from every row", JSON.stringify(teamGames.get("MTL")) === JSON.stringify([11, 12]));
  check("played flags", JSON.stringify(playedFlags([11, 12], byPlayer.get(2)!, "MTL")) === JSON.stringify([true, false]));
  const traded = [
    { gameId: 13, date: "2026-10-02", team: "TOR", toi: 15, pp: 1 },
    { gameId: 12, date: "2026-10-03", team: "MTL", toi: 15, pp: 1 },
  ];
  check("traded: his games as the latest of his club's", JSON.stringify(playedFlags([11, 12, 14], traded, "MTL")) === JSON.stringify([false, true, true]));
  check("current absence trimmed", JSON.stringify(trimCurrentAbsence([true, false, true, false, false], 5)) === JSON.stringify([true, false, true]));
  check("trim stops at a game he played", JSON.stringify(trimCurrentAbsence([true, false, false], 1)) === JSON.stringify([true, false]));
  const pu = priorUsageOf([{ gp: 80, toi: 80 * 20, pp: 80 * 3 }, { gp: 40, toi: 40 * 14, pp: 0 }]);
  check("prior usage 2:1 by games", near(pu.toi ?? 0, (2 * 1600 + 560) / 200) && near(pu.pp ?? 0, (2 * 240) / 200));
  check("prior usage unknown", priorUsageOf([undefined, { gp: 0, toi: 0, pp: 0 }]).toi === null);
}

// ---- newcomer prior from his role (src/lib/inseason/newcomer.ts)
check("newcomer K 10", NEWCOMER_USAGE_K === 10);
check(
  "first-line call-up out-produces a fourth-liner",
  newcomerRates("F", 18, 2.5).assists > newcomerRates("F", 10, 0).assists && newcomerRates("F", 18, 2.5).goals > newcomerRates("F", 10, 0).goals,
);
check("first-pair D plays more of his team's games", newcomerShare("D", 21) > newcomerShare("D", 14));
check("newcomer rates never negative", Object.values(newcomerRates("D", 5, 0)).every((x) => x >= 0));
check("newcomer share within [0.05, 0.95]", newcomerShare("F", 1) >= 0.05 && newcomerShare("F", 40) <= 0.95);

// ---- backtest guard: the published constants are the backtested ones, and
// the new update beats the one it replaced (src/data/ml/in-season-*backtest.json).
type Cell = { n: number; cur: number; new: number; seasonsWon: number };
const readJson = <T,>(...p: string[]) => JSON.parse(readFileSync(join(process.cwd(), ...p), "utf8")) as T;
{
  const bt = readJson<{
    priors: string;
    params: { usage: unknown; rules: unknown; shootingK: number; shareK: number; shareHalfLife: number; shareToi: number; shareSkipAbsence: number };
    current: { rateK: unknown; shareK: number };
    summary: Record<string, Record<string, Cell>>;
    loso: Record<string, { cur: number; new: number }>;
  }>("src", "data", "ml", "in-season-backtest.json");
  check("skater backtest on the walk-forward v2 priors", bt.priors === "v2-walk-forward", bt.priors);
  check(
    "skater backtest ran with the published usage constants (npm run inseason:backtest)",
    JSON.stringify(bt.params.usage) === JSON.stringify(USAGE_PARAMS) &&
      JSON.stringify(bt.params.rules) === JSON.stringify(STAT_RULES) &&
      bt.params.shootingK === SHOOTING_K &&
      bt.params.shareK === SHARE_K &&
      bt.params.shareHalfLife === SHARE_HALF_LIFE &&
      bt.params.shareToi === SHARE_TOI_ELASTICITY &&
      bt.params.shareSkipAbsence === SHARE_SKIP_ABSENCE,
    JSON.stringify(bt.params),
  );
  check(
    "skater backtest compared with the published box-stat update",
    JSON.stringify(bt.current.rateK) === JSON.stringify(SKATER_RATE_K) && bt.current.shareK === SKATER_SHARE_K,
  );
  for (const metric of ["slapshot", "captains", "ltl", "gp", "slapshotRateOnly"]) {
    for (const [cell, c] of Object.entries(bt.summary[metric] ?? {})) {
      check(`skater ${metric} ${cell}: new ≤ current`, c.new <= c.cur, `${c.new} vs ${c.cur}`);
      if (cell === "all") check(`skater ${metric}: better in every season`, c.seasonsWon === 5, String(c.seasonsWon));
    }
  }
  const loso = Object.entries(bt.loso ?? {});
  check("skater leave-one-season-out scores present", loso.length === 5, String(loso.length));
  for (const [s, x] of loso) check(`skater LOSO ${s}: new < current`, x.new < x.cur, `${x.new} vs ${x.cur}`);
}
{
  const bt = readJson<{ k: number; lines: { rates: unknown; share: unknown }; summary: Record<string, Record<string, Cell>> }>(
    "src", "data", "ml", "in-season-newcomer-backtest.json",
  );
  check(
    "newcomer lines are the backtested fit (npm run inseason:backtest)",
    JSON.stringify(bt.lines.rates) === JSON.stringify(NEWCOMER_RATE_LINES) && JSON.stringify(bt.lines.share) === JSON.stringify(NEWCOMER_SHARE_LINES) && bt.k === NEWCOMER_USAGE_K,
  );
  for (const metric of ["slapshot", "captains", "gp"]) {
    const c = bt.summary[metric]?.all;
    check(`newcomer ${metric}: new < current, every season`, !!c && c.new < c.cur && c.seasonsWon === 5, JSON.stringify(c));
  }
}
{
  const bt = readJson<{ published: unknown; loso: Record<string, { cur: number; new: number }> }>("src", "data", "ml", "in-season-goalie-backtest.json");
  check("goalie backtest ran against the published goalie rules", JSON.stringify(bt.published) === JSON.stringify(GOALIE_RULES), JSON.stringify(bt.published));
  check("goalie tuned variant scored on every season left out", Object.keys(bt.loso ?? {}).length === 5);
  check(
    "goalie rules are the published box-stat ones (no variant beat them)",
    GOALIE_RULES.wins.k === GOALIE_K.wins &&
      GOALIE_RULES.shotsAgainst.k === GOALIE_K.shotsAgainstPerGame &&
      GOALIE_RULES.shutouts.k === GOALIE_K.shutouts &&
      GOALIE_RULES.savePctShots === GOALIE_K.savePctShots &&
      GOALIE_RULES.shareK === GOALIE_SHARE_K &&
      GOALIE_RULES.wins.team === 0 &&
      GOALIE_RULES.shotsAgainst.team === 0 &&
      GOALIE_RULES.shutouts.team === 0 &&
      GOALIE_RULES.shareHalfLife === 0,
  );
}
{
  // The frozen sample re-scored with the code as it stands (no network, no cache).
  const fx = readJson<Fixture>("src", "data", "ml", "in-season-fixture.json");
  const sc = scoreFixture(fx.players);
  check("fixture: hundreds of checkpoints", sc.n >= 500, String(sc.n));
  check("fixture: the box-stat update scores as when written", Math.abs(sc.cur - fx.expected.cur) < 1e-3, `${sc.cur} vs ${fx.expected.cur}`);
  check("fixture: the usage-aware update no worse than when written", sc.new <= fx.expected.new + 1e-3, `${sc.new} vs ${fx.expected.new}`);
  check("fixture: the usage-aware update beats the box-stat one by ≥ 1 %", sc.new <= 0.99 * sc.cur, `${sc.new} vs ${sc.cur}`);
}

if (failed > 0) {
  console.error(`${failed} in-season check(s) failed`);
  process.exit(1);
}
console.log("OK: in-season rules");
