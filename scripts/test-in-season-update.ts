/**
 * The daily in-season update (scripts/update-in-season.ts) run end to end,
 * offline, on a frozen sample: two clubs ten games into a twenty-game
 * schedule, a regular, a pool player who has not dressed (sent down, not on
 * the injury report), a hurt player with a return date, a call-up with no
 * pre-season projection, a goalie. Every request is answered from a replay
 * (IN_SEASON_REPLAY), so no network. Checks that the script WIRES the
 * backtested rules (src/lib/inseason/*): each skater's remaining games come
 * from gamesShareNow, his rates from restOfSeasonRates with his role, the
 * call-up from the newcomer lines, and `inSeason.usage` is written; and,
 * with the game-by-game ice-time report down, the documented fallback (role
 * ratios 1, games share of src/lib/in-season.ts, rates still from
 * restOfSeasonRates). Reverting the wiring to the box-stat update fails here
 * even if the library functions are untouched.
 * Run: npx tsx scripts/test-in-season-update.ts
 */
import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { createRequire } from "module";
import { tmpdir } from "os";
import { join } from "path";
import { SKATER_SHARE_K, updatedGameShare } from "../src/lib/in-season";
import { gamesFromRows, playedFlags, priorUsageOf, trimCurrentAbsence } from "../src/lib/inseason/live";
import { newcomerRates, newcomerShare } from "../src/lib/inseason/newcomer";
import { gamesShareNow, restOfSeasonRates, USAGE_STATS, usageNow, type Usage, type UsageStat } from "../src/lib/inseason/skater";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) {
    failed++;
    console.error(`FAIL: ${name}${detail ? ` (${detail})` : ""}`);
  }
}
const r1 = (x: number) => Math.round(x * 10) / 10;
const near = (a: number, b: number, eps = 0.051) => Math.abs(a - b) <= eps;

// ---------------------------------------------------------------- the sample
const day = (i: number) => `2026-10-${String(i + 1).padStart(2, "0")}`;
const schedule = Array.from({ length: 20 }, (_, i) => [`${day(i)}T23:00:00Z`, i % 2 ? "TOR" : "MTL", i % 2 ? "MTL" : "TOR"]);
const NOW = "2026-10-11T12:00:00Z"; // ten games played, ten left
const gid = (i: number) => 2026020001 + i;
type P = { id: number; name: string; team: string; position: string; isGoalie: boolean; gamesPlayed: number; projection: Record<string, number> };
const skater = (id: number, name: string, team: string, position: string, gamesPlayed: number, per82: number[]): P => ({
  id,
  name,
  team,
  position,
  isGoalie: false,
  gamesPlayed,
  projection: Object.fromEntries(USAGE_STATS.map((s, i) => [s, (per82[i]! * gamesPlayed) / 82])),
});
const base: P[] = [
  skater(1, "Regular One", "MTL", "C", 74, [28, 40, 20, 230, 45, 25, 20, 420]),
  skater(2, "Absent Two", "MTL", "D", 66, [6, 22, 8, 120, 90, 110, 30, 0]),
  skater(3, "Hurt Three", "TOR", "RW", 70, [24, 26, 12, 200, 70, 30, 40, 10]),
  skater(6, "Regular Six", "TOR", "D", 78, [8, 30, 12, 150, 60, 120, 24, 0]),
  { id: 5, name: "Goalie Five", team: "MTL", position: "G", isGoalie: true, gamesPlayed: 55, projection: { wins: 30, shutouts: 3, saves: 1450, savePct: 0.906 } },
];
/** Game-by-game: [player, team, games (0-based), toi min, pp min, per-game box line]. */
const lines: Array<[number, string, number[], number, number, number[]]> = [
  [1, "MTL", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 21, 3.5, [1, 1, 1, 4, 1, 0, 0, 7]],
  [3, "TOR", [0, 1, 2, 3, 4, 5], 16, 1, [0, 1, 0, 3, 2, 1, 2, 0]],
  [6, "TOR", [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 22, 2, [0, 1, 0, 2, 1, 2, 0, 0]],
  [4, "TOR", [5, 6, 7, 8, 9], 15, 0.5, [0, 0, 0, 2, 2, 1, 0, 3]],
];
const gameRows = lines.flatMap(([playerId, team, games, toi, pp]) =>
  games.map((g) => ({ playerId, gameId: gid(g), gameDate: day(g), teamAbbrev: team, timeOnIce: toi * 60 + g, ppTimeOnIce: pp * 60 })),
);
const tot = (id: number) => {
  const l = lines.find((x) => x[0] === id)!;
  return Object.fromEntries(USAGE_STATS.map((s, i) => [s, l[5][i]! * l[2].length])) as Record<UsageStat, number>;
};
const summaryRow = (id: number, name: string, pos: string) => {
  const l = lines.find((x) => x[0] === id)!;
  const t = tot(id);
  return { playerId: id, skaterFullName: name, positionCode: pos, teamAbbrevs: l[1], gamesPlayed: l[2].length, goals: t.goals, assists: t.assists, ppPoints: t.powerplayPoints, shots: t.shots, penaltyMinutes: t.penaltyMinutes };
};
const summary = [summaryRow(1, "Regular One", "C"), summaryRow(3, "Hurt Three", "R"), summaryRow(6, "Regular Six", "D"), summaryRow(4, "New Four", "L")];
const realtime = summary.map((r) => ({ playerId: r.playerId, hits: tot(r.playerId).hits, blockedShots: tot(r.playerId).blocks }));
const faceoffs = summary.map((r) => ({ playerId: r.playerId, totalFaceoffWins: tot(r.playerId).faceoffWins }));
const prior = (season: 0 | 1) =>
  [
    [1, 80, 19, 3],
    [2, 70, 20, 1],
    [3, 75, 17, 1.5],
    [6, 82, 22, 2],
  ].map(([playerId, gp, toi, pp]) => ({ playerId, gamesPlayed: gp! - season * 10, timeOnIce: gp! * toi! * 60, ppTimeOnIce: gp! * pp! * 60 }));
const espn = {
  injuries: [
    { injuries: [{ status: "Out", date: "2026-10-07T15:00Z", details: { returnDate: "2026-10-15", type: "Knee" }, athlete: { displayName: "Hurt Three", team: { abbreviation: "TOR" } } }] },
  ],
};
const goalieRows = [{ playerId: 5, goalieFullName: "Goalie Five", teamAbbrevs: "MTL", gamesPlayed: 7, wins: 4, shutouts: 1, saves: 190, shotsAgainst: 205 }];
const responses = (withGames: boolean) => [
  ...(withGames ? [{ match: "skater/timeonice?isAggregate=false&isGame=true", body: { data: gameRows, total: gameRows.length } }] : []),
  { match: "skater/timeonice?limit=-1&cayenneExp=seasonId=20252026", body: { data: prior(0) } },
  { match: "skater/timeonice?limit=-1&cayenneExp=seasonId=20242025", body: { data: prior(1) } },
  { match: "skater/summary?", body: { data: summary } },
  { match: "skater/realtime?", body: { data: realtime } },
  { match: "skater/faceoffwins?", body: { data: faceoffs } },
  { match: "goalie/summary?", body: { data: goalieRows } },
  { match: "espn.com/apis/site/v2/sports/hockey/nhl/injuries", body: espn },
];

type Out = { id: number; gamesPlayed: number; projection: Record<string, number>; inSeason: { gp: number; teamLeft: number; rosGames: number; newcomer?: true; usage?: { toi: number; toiRatio: number }; injury: { gamesOut: number } | null } };
function run(withGames: boolean): Map<number, Out> {
  const dir = mkdtempSync(join(tmpdir(), "in-season-update-"));
  try {
    mkdirSync(join(dir, "src", "data"), { recursive: true });
    mkdirSync(join(dir, "public", "fantrax"), { recursive: true });
    const players = JSON.stringify({ players: base });
    writeFileSync(join(dir, "src", "data", "players-preseason.json"), players);
    writeFileSync(join(dir, "src", "data", "players.json"), players);
    writeFileSync(join(dir, "public", "fantrax", "schedule-20262027.json"), JSON.stringify({ season: 20262027, games: schedule }));
    const replay = join(dir, "replay.json");
    writeFileSync(replay, JSON.stringify({ responses: responses(withGames) }));
    const tsx = createRequire(import.meta.url).resolve("tsx/cli");
    execFileSync(process.execPath, [tsx, join(process.cwd(), "scripts", "update-in-season.ts")], {
      env: { ...process.env, IN_SEASON_ROOT: dir, IN_SEASON_NOW: NOW, IN_SEASON_REPLAY: replay },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = JSON.parse(readFileSync(join(dir, "src", "data", "players.json"), "utf8")) as { players: Out[] };
    return new Map(out.players.map((p) => [p.id, p]));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- expected, from the library
const { byPlayer, teamGames } = gamesFromRows(gameRows);
const priorAgg = (id: number) =>
  ([0, 1] as const).map((s) => {
    const r = prior(s).find((x) => x.playerId === id);
    return r ? { gp: r.gamesPlayed, toi: r.timeOnIce / 60, pp: r.ppTimeOnIce / 60 } : undefined;
  });
const usageOf = (id: number, withPrior: boolean): Usage => {
  const mine = byPlayer.get(id) ?? [];
  const pu = withPrior ? priorUsageOf(priorAgg(id)) : { toi: null, pp: null };
  return usageNow({ toiPrior: pu.toi, ppPrior: pu.pp, toi: mine.map((g) => g.toi), pp: mine.map((g) => g.pp) });
};
const ratesOf = (b: P, usage: Usage, gp: number) => {
  const pr = Object.fromEntries(USAGE_STATS.map((s) => [s, (b.projection[s] ?? 0) / b.gamesPlayed])) as Record<UsageStat, number>;
  return restOfSeasonRates({ prior: pr, totals: gp > 0 ? tot(b.id) : (Object.fromEntries(USAGE_STATS.map((s) => [s, 0])) as Record<UsageStat, number>), gp, usage });
};

{
  const out = run(true);
  const left = 10;
  // The regular: share and rates from his role.
  const b1 = base[0]!;
  const u1 = usageOf(1, true);
  const ros1 = left * gamesShareNow(b1.gamesPlayed / 82, playedFlags(teamGames.get("MTL")!, byPlayer.get(1)!, "MTL"), u1);
  const p1 = out.get(1)!;
  check("regular: ten team games left", p1.inSeason.teamLeft === left, String(p1.inSeason.teamLeft));
  check("regular: remaining games from gamesShareNow", near(p1.inSeason.rosGames, r1(ros1)), `${p1.inSeason.rosGames} vs ${ros1}`);
  const rates1 = ratesOf(b1, u1, 10);
  for (const s of ["goals", "assists", "shots", "hits"] as const)
    check(`regular: ${s} = to date + restOfSeasonRates × remaining games`, near(p1.projection[s]!, r1(tot(1)[s] + rates1[s] * ros1), 0.11), `${p1.projection[s]} vs ${tot(1)[s] + rates1[s] * ros1}`);
  check("regular: his role is written (inSeason.usage)", !!p1.inSeason.usage && near(p1.inSeason.usage.toiRatio, Math.round(u1.toiRatio * 100) / 100, 0.006), JSON.stringify(p1.inSeason.usage));
  check("regular: a promoted role raises his goals rate", rates1.goals > (b1.projection.goals! / b1.gamesPlayed) * 0.9);

  // The pool player who has not dressed (not on the injury report): his share falls.
  const b2 = base[1]!;
  const ros2 = left * gamesShareNow(b2.gamesPlayed / 82, Array.from({ length: 10 }, () => false), usageOf(2, true));
  const p2 = out.get(2)!;
  check("absent: remaining games from gamesShareNow over his missed games", near(p2.inSeason.rosGames, r1(ros2)), `${p2.inSeason.rosGames} vs ${ros2}`);
  check("absent: well below his pre-season share", p2.inSeason.rosGames < 0.75 * left * (b2.gamesPlayed / 82), String(p2.inSeason.rosGames));
  check("absent: no usage without a game", !p2.inSeason.usage);

  // The hurt player: the games before his return out, his current absence left out of the share.
  const b3 = base[2]!;
  const p3 = out.get(3)!;
  const flags3 = trimCurrentAbsence(playedFlags(teamGames.get("TOR")!, byPlayer.get(3)!, "TOR"), 4);
  const ros3 = (left - 4) * gamesShareNow(b3.gamesPlayed / 82, flags3, usageOf(3, true));
  check("hurt: four games out before his return", p3.inSeason.injury?.gamesOut === 4, JSON.stringify(p3.inSeason.injury));
  check("hurt: the share over the games before his injury", flags3.length === 6 && near(p3.inSeason.rosGames, r1(ros3)), `${p3.inSeason.rosGames} vs ${ros3}`);

  // The call-up: the newcomer lines from his ice time.
  const p4 = out.get(4);
  const u4 = usageOf(4, false);
  const share4 = newcomerShare("F", u4.toi ?? 0);
  const ros4 = left * updatedGameShare(share4, 5, 5, 10);
  const rates4 = newcomerRates("F", u4.toi ?? 0, u4.pp ?? 0);
  check("call-up: projected", !!p4 && p4.inSeason.newcomer === true);
  check("call-up: remaining games from his role's share", !!p4 && near(p4.inSeason.rosGames, r1(ros4)), `${p4?.inSeason.rosGames} vs ${ros4}`);
  check("call-up: his role is written", !!p4?.inSeason.usage);
  const shots4 = tot(4).shots + ((rates4.shots * 10 + tot(4).shots) / (10 + 5)) * ros4;
  check("call-up: shots from the newcomer lines (K 10)", !!p4 && near(p4.projection.shots!, r1(shots4), 0.11), `${p4?.projection.shots} vs ${shots4}`);

  check("goalie: still updated", (out.get(5)?.inSeason.gp ?? 0) === 7);
}
{
  // Game-by-game report down: role ratios 1, games share of src/lib/in-season.ts,
  // the rates still from restOfSeasonRates (not the box-stat update).
  const out = run(false);
  const b1 = base[0]!;
  const p1 = out.get(1)!;
  const flat: Usage = { toi: null, pp: null, toiRatio: 1, ppRatio: 1 };
  const ros1 = 10 * updatedGameShare(b1.gamesPlayed / 82, 10, 10, SKATER_SHARE_K);
  const rates1 = ratesOf(b1, flat, 10);
  check("fallback: no usage written", !p1.inSeason.usage);
  check("fallback: games share of the season totals (K 30)", near(p1.inSeason.rosGames, r1(ros1)), `${p1.inSeason.rosGames} vs ${ros1}`);
  check("fallback: goals still from shots × regressed shooting %", near(p1.projection.goals!, r1(tot(1).goals + rates1.goals * ros1), 0.11), `${p1.projection.goals} vs ${tot(1).goals + rates1.goals * ros1}`);
  const p2 = out.get(2)!;
  check("fallback: the absent player on the season totals", near(p2.inSeason.rosGames, r1(10 * updatedGameShare(base[1]!.gamesPlayed / 82, 0, 10, SKATER_SHARE_K))), String(p2.inSeason.rosGames));
}

if (failed > 0) {
  console.error(`${failed} in-season update check(s) failed`);
  process.exit(1);
}
console.log("OK: in-season update wiring (offline replay)");
