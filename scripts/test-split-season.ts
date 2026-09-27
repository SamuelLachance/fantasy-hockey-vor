/**
 * Split seasons (an NHL season shared with another league) are not injury
 * seasons: league-seasons parsing, the availability helpers, the injury
 * profile and the split-season GP rule.
 * Run: npx tsx scripts/test-split-season.ts
 */
import {
  isSplitSeason,
  lastSeasonSplit,
  otherLeaguesFromLines,
  SPLIT_SEASON_MIN_OTHER_GAMES,
  UNMEASURED_DURABILITY,
} from "../src/lib/split-season";
import {
  isClubLeague,
  nhlGamesIn,
  otherLeagueGamesIn,
  parseLeagueSeasonTotals,
  toiToSeconds,
  type LeagueSeasonsCache,
} from "../src/lib/league-seasons";
import {
  calibratedSkaterGp,
  decideSkaterGp,
  type SplitSeasonRule,
} from "../src/lib/gp-calibration";
import type { LeagueSeasonLine, LeagueSeasonsPlayer } from "../src/lib/league-seasons";
import type { DurabilityRecord } from "../src/lib/ml/gamelog-durability";
import { readFileSync } from "fs";
import { join } from "path";
import { projectSkaterFromProfile } from "../src/lib/contextual-projections";
import { buildInjuryProfile, normalizeProfile } from "../src/lib/player-profile";
import type { OtherLeagueSeason, PlayerProfile, SeasonHistory } from "../src/lib/profile-types";
import { rateFitGamesPlayed } from "../src/lib/rate-calibration";
import {
  loadSplitSeasonGpParams,
  predictSplitSeasonGp,
  splitSeasonInput,
  type SplitSeasonGpParams,
  type SplitSeasonInput,
} from "../src/lib/split-season-gp";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}

// --- landing seasonTotals → league lines ---
const hutsonTotals = [
  { season: 20242025, leagueAbbrev: "NCAA", gameTypeId: 2, gamesPlayed: 39 },
  { season: 20242025, leagueAbbrev: "WJC-20", gameTypeId: 2, gamesPlayed: 7 },
  { season: 20252026, leagueAbbrev: "NHL", gameTypeId: 2, gamesPlayed: 14, avgToi: "17:27" },
  { season: 20252026, leagueAbbrev: "NHL", gameTypeId: 3, gamesPlayed: 5, avgToi: "15:00" },
  { season: 20252026, leagueAbbrev: "NCAA", gameTypeId: 2, gamesPlayed: 35 },
  { season: 20252026, leagueAbbrev: "WJC-20", gameTypeId: 2, gamesPlayed: 3 },
  { season: 19981999, leagueAbbrev: "OHL", gameTypeId: 2, gamesPlayed: 60 },
];
const lines = parseLeagueSeasonTotals(hutsonTotals);
assert(toiToSeconds("17:27") === 1047, "TOI string → seconds");
assert(
  JSON.stringify(lines.filter((l) => l[0] === 20252026)) ===
    JSON.stringify([
      [20252026, "NHL", 14, 1047],
      [20252026, "NCAA", 35],
      [20252026, "WJC-20", 3],
    ]),
  `2025-26 lines: regular season only, NHL first with TOI (got ${JSON.stringify(lines)})`,
);
assert(!lines.some((l) => l[0] < 20002001), "seasons before 2000-01 dropped");
const traded = parseLeagueSeasonTotals([
  { season: 20242025, leagueAbbrev: "NHL", gameTypeId: 2, gamesPlayed: 20, avgToi: "10:00" },
  { season: 20242025, leagueAbbrev: "NHL", gameTypeId: 2, gamesPlayed: 60, avgToi: "20:00" },
]);
assert(
  traded.length === 1 && traded[0][2] === 80 && traded[0][3] === 1050,
  `a trade season sums NHL games and GP-weights TOI (got ${JSON.stringify(traded)})`,
);
assert(isClubLeague("AHL") && isClubLeague("NCAA") && isClubLeague("SHL"), "club leagues");
assert(
  !isClubLeague("NHL") && !isClubLeague("WJC-20") && !isClubLeague("WC") && !isClubLeague("OG") && !isClubLeague("4 Nations"),
  "the NHL and international events are not other club leagues",
);
const hutsonCache = { pos: "D", birth: "2006-06-28", draft: 43, draftYear: 2024, seasons: lines };
assert(otherLeagueGamesIn(hutsonCache, 20252026).games === 35, "35 NCAA games in 2025-26 (WJC left out)");
assert(nhlGamesIn(hutsonCache, 20252026).games === 14, "14 NHL games in 2025-26");

// --- availability ---
assert(!isSplitSeason(SPLIT_SEASON_MIN_OTHER_GAMES - 1), "a conditioning loan is not a split season");
assert(isSplitSeason(SPLIT_SEASON_MIN_OTHER_GAMES), "threshold games make a split season");
const other = otherLeaguesFromLines(lines, [20252026]);
assert(
  other.length === 1 && other[0].gamesPlayed === 35 && other[0].leagues.join() === "NCAA",
  `other leagues of the profile's seasons (got ${JSON.stringify(other)})`,
);

function season(seasonId: number, gamesPlayed: number, isGoalie = false): SeasonHistory {
  return { season: String(seasonId), seasonId, team: "T", gamesPlayed, isGoalie, stats: {}, advanced: {} };
}
const cache: LeagueSeasonsCache = {
  builtAt: "",
  source: "",
  players: { "8484873": hutsonCache },
};
const hutsonProfile = { id: 8484873, teamHistory: [season(20252026, 14)] };
const split = lastSeasonSplit(hutsonProfile, false, cache);
assert(split?.otherGames === 35 && split.nhlGames === 14, "Hutson's 2025-26 is a split season (cache backfill)");
assert(lastSeasonSplit({ id: 1, teamHistory: [season(20252026, 14)] }, false, cache) === null, "unknown player: no split");
assert(
  lastSeasonSplit({ id: 1, teamHistory: [season(20252026, 14)], otherLeagues: [] }, false, cache) === null,
  "known with no other league: no split",
);

// --- injury profile ---
const ncaa: OtherLeagueSeason[] = [{ seasonId: 20252026, gamesPlayed: 35, leagues: ["NCAA"] }];
const hutson = buildInjuryProfile([season(20252026, 14)], false, ncaa);
assert(hutson.trend === "healthy", `NCAA late signing is healthy (got ${hutson.trend})`);
assert(hutson.gamesMissedLastSeason === 0, "no NHL game counted as missed after an NCAA season");
assert(hutson.durabilityScore === UNMEASURED_DURABILITY, "no NHL-only season: unmeasured durability");
assert(hutson.gamesPlayedLastSeason === 14, "last-season NHL GP kept as played");
assert(/NCAA/.test(hutson.note) && !/durability concern/.test(hutson.note), `note explains the split (${hutson.note})`);

// Same seasons without the other-league data: the old reading (injury prone).
const blind = buildInjuryProfile([season(20252026, 14)], false);
assert(blind.trend === "injury_prone" && blind.gamesMissedLastSeason === 68, "without league data: the NHL-only reading");

// AHL call-up, two split seasons.
const callUp = buildInjuryProfile(
  [season(20242025, 20), season(20252026, 35)],
  false,
  [
    { seasonId: 20242025, gamesPlayed: 50, leagues: ["AHL"] },
    { seasonId: 20252026, gamesPlayed: 40, leagues: ["AHL"] },
  ],
);
assert(callUp.trend === "healthy" && callUp.gamesMissedLastSeason === 0, "AHL call-up is not injury prone");

// Old split seasons, then a full NHL season: durability from the NHL season.
const graduated = buildInjuryProfile(
  [season(20232024, 20), season(20242025, 30), season(20252026, 80)],
  false,
  [
    { seasonId: 20232024, gamesPlayed: 50, leagues: ["AHL"] },
    { seasonId: 20242025, gamesPlayed: 40, leagues: ["AHL"] },
  ],
);
assert(graduated.durabilityScore === 0.98 && graduated.trend === "healthy", `durability from NHL-only seasons (got ${graduated.durabilityScore})`);

// Genuinely injured veteran: identical with or without league data.
const vetSeasons = [season(20232024, 80), season(20242025, 78), season(20252026, 30)];
const vet = buildInjuryProfile(vetSeasons, false, []);
const vetBlind = buildInjuryProfile(vetSeasons, false);
assert(JSON.stringify(vet) === JSON.stringify(vetBlind), "injured veteran: league data changes nothing");
assert(vet.trend === "injury_prone" && vet.gamesMissedLastSeason === 52, "injured veteran stays injury prone");

// Conditioning loan (3 AHL games) during an injury season: still an injury season.
const rehab = buildInjuryProfile(vetSeasons, false, [
  { seasonId: 20252026, gamesPlayed: 3, leagues: ["AHL"] },
]);
assert(JSON.stringify(rehab) === JSON.stringify(vetBlind), "a conditioning loan keeps the injury reading");

// Goalie split season: platoon note, not an injury.
const goalie = buildInjuryProfile([season(20252026, 20, true)], true, [
  { seasonId: 20252026, gamesPlayed: 23, leagues: ["AHL"] },
]);
assert(goalie.trend === "moderate" && /AHL/.test(goalie.note) && goalie.gamesMissedLastSeason === 0, `goalie split (${goalie.note})`);

// --- published GP: the split-season rule vs the isotonic curve ---
// Synthetic rule: split GP = 20 + 30·finished + toi; away GP = 5.
const params: SplitSeasonGpParams = {
  version: 1,
  fittedAt: "",
  source: "test",
  minOtherGames: SPLIT_SEASON_MIN_OTHER_GAMES,
  split: { features: ["finished", "toi"], intercept: 20, coef: [30, 1], finishedMean: 0.5, gameScorePrior: 0.3, floor: 0, ceiling: 80 },
  away: { features: [], intercept: 5, coef: [], finishedMean: 0.5, gameScorePrior: 0.3, floor: 0, ceiling: 80 },
};
function dur(played: number, tail: number): DurabilityRecord {
  return {
    played, window: played, head: 0, tail, inj: 0, inj8: 0, scratch: 0, trans: 0, spells: 0, spells8: 0,
    longestGap: 0, share: played / 82, teamGames: 82, streak: 0, fullSeason: 0, lateMiss: 0, latePlayed: 0, teamB2b: 0,
  };
}
const durBy = new Map<string, DurabilityRecord>();
const leagueBy = new Map<number, LeagueSeasonsPlayer>();
function player(
  id: number,
  lines: LeagueSeasonLine[],
  logs: Array<[number, number, number]>,
  pos = "D",
): void {
  leagueBy.set(id, { pos, birth: "2006-06-28", draft: 43, draftYear: 2024, seasons: lines });
  for (const [seasonId, played, tail] of logs) durBy.set(`${id}:${seasonId}`, dur(played, tail));
}
// NCAA late signing: 35 college games, then 14 NHL games to the last one at 17:27.
player(1, [[20252026, "NHL", 14, 1047], [20252026, "NCAA", 35]], [[20252026, 14, 0]]);
// AHL call-up sent back down: 3 NHL games at 11:00, 60 AHL games.
player(2, [[20252026, "NHL", 3, 660], [20252026, "AHL", 60]], [[20252026, 3, 40]]);
// Injured veteran: 30 NHL games, nothing elsewhere.
player(3, [[20242025, "NHL", 80, 1200], [20252026, "NHL", 30, 1200]], [[20242025, 80, 0], [20252026, 30, 0]]);
// Full NHL season.
player(4, [[20252026, "NHL", 82, 1100]], [[20252026, 82, 0]]);
// Injured veteran with a 3-game conditioning loan.
player(5, [[20252026, "NHL", 40, 1200], [20252026, "AHL", 3]], [[20252026, 40, 0]]);
// Away: 46 NHL games in 2024-25, then a full AHL season.
player(6, [[20242025, "NHL", 46, 1100], [20252026, "AHL", 63]], [[20242025, 46, 0]]);
// Goalie split season: never through the skater rule.
player(7, [[20252026, "NHL", 20, 3600], [20252026, "AHL", 23]], [[20252026, 20, 0]], "G");

const rule: SplitSeasonRule = {
  params,
  projectionSeasonId: 20262027,
  sources: {
    durability: (id, s) => durBy.get(`${id}:${s}`),
    leagues: (id) => leagueBy.get(id),
    moneypuck: () => undefined,
  },
};
const gpCurve = [
  { x: 30, y: 20 },
  { x: 45, y: 32 },
  { x: 60, y: 73 },
];
const withHistory = (id: number, gps: Array<[number, number]>) =>
  ({ id, teamHistory: gps.map(([s, gp]) => season(s, gp)) }) as unknown as PlayerProfile;
const skater = (id: number, gp: number) => ({ id, team: "T", isGoalie: false, gamesPlayed: gp, modelGamesPlayed: gp });

const hutsonGp = decideSkaterGp(skater(1, 45), withHistory(1, [[20252026, 14]]), gpCurve, rule);
assert(hutsonGp.curveGamesPlayed === 32, `the curve reads the late signing as 32 games (got ${hutsonGp.curveGamesPlayed})`);
assert(hutsonGp.gamesPlayed === 67 && hutsonGp.availability?.kind === "split", `NCAA late signing takes the rule (got ${hutsonGp.gamesPlayed})`);
assert(hutsonGp.availability?.league === "college" && hutsonGp.availability.otherGames === 35, "rule marker: college, 35 games");
const again = decideSkaterGp({ ...skater(1, 45), gamesPlayed: hutsonGp.gamesPlayed }, withHistory(1, [[20252026, 14]]), gpCurve, rule);
assert(again.gamesPlayed === hutsonGp.gamesPlayed, "rule is idempotent (anchored on modelGamesPlayed)");

const sentDown = decideSkaterGp(skater(2, 40), withHistory(2, [[20252026, 3]]), gpCurve, rule);
assert(sentDown.gamesPlayed === 31 && sentDown.availability?.league === "ahl", `AHL call-up sent down (got ${sentDown.gamesPlayed})`);

for (const [id, label, gp] of [
  [3, "injured veteran", 50],
  [4, "full season", 60],
  [5, "conditioning loan", 50],
] as const) {
  const hist: Array<[number, number]> = id === 3 ? [[20242025, 80], [20252026, 30]] : id === 4 ? [[20252026, 82]] : [[20252026, 40]];
  const d = decideSkaterGp(skater(id, gp), withHistory(id, hist), gpCurve, rule);
  const curveOnly = calibratedSkaterGp(skater(id, gp), withHistory(id, hist), gpCurve);
  assert(d.availability === null && d.gamesPlayed === curveOnly, `${label}: the curve, unchanged (${d.gamesPlayed} vs ${curveOnly})`);
}
const away = decideSkaterGp(skater(6, 55), withHistory(6, [[20242025, 46]]), gpCurve, rule);
assert(away.gamesPlayed === 5 && away.availability?.kind === "away", `a season spent in the AHL takes the away rule (got ${away.gamesPlayed})`);
assert(
  decideSkaterGp(skater(1, 45), withHistory(1, [[20252026, 14]]), gpCurve, null).gamesPlayed === 32,
  "without a rule every skater keeps the curve",
);
assert(
  decideSkaterGp(skater(8, 58), undefined, gpCurve, rule).gamesPlayed === 58,
  "no NHL history: model GP, no rule",
);
assert(splitSeasonInput(7, 20262027, rule.sources) === null, "goalies never take the skater rule");

// The rate calibration pools a rule player on the curve's GP (as its reference did).
assert(rateFitGamesPlayed({ gamesPlayed: 67, availability: { curveGamesPlayed: 32 } }) === 32, "rate pool: curve GP");
assert(rateFitGamesPlayed({ gamesPlayed: 70 }) === 70, "rate pool: published GP otherwise");

// The committed fit (walk-forward: unbiased on 26 Hutson-like seasons where the
// curve was 38 games low): a Hutson-like season well above the curve's 32, an
// AHL veteran sent back down as a depth call-up, a season in the KHL near zero.
const fitted = loadSplitSeasonGpParams();
assert(fitted !== null, "src/data/ml/split-season-gp.json is committed");
if (fitted) {
  const base: SplitSeasonInput = {
    kind: "split", seasonId: 20252026, isDefense: true, age: 20.3, draftPick: 43, nhlGp82: 14,
    toiMinutes: 17.45, otherGames: 35, league: "college", finished: true, careerGpBefore: 0, seasonsAway: 0,
    gameScore: 7.45, mpGames: 14,
  };
  const hutsonFit = predictSplitSeasonGp(fitted, base);
  const vetFit = predictSplitSeasonGp(fitted, {
    ...base, age: 29, draftPick: null, nhlGp82: 3, toiMinutes: 11, otherGames: 60, league: "ahl", finished: false, careerGpBefore: 40,
    gameScore: 0.6, mpGames: 3,
  });
  const khlFit = predictSplitSeasonGp(fitted, {
    ...base, kind: "away", age: 30, draftPick: 120, nhlGp82: 46, toiMinutes: 16, otherGames: 68, league: "europe", finished: null, careerGpBefore: 250, seasonsAway: 1,
    gameScore: 12, mpGames: 46,
  });
  assert(hutsonFit >= 42, `fitted rule: Hutson-like season ≥ 42 GP (got ${hutsonFit.toFixed(1)})`);
  assert(vetFit <= 20, `fitted rule: AHL veteran sent down ≤ 20 GP (got ${vetFit.toFixed(1)})`);
  assert(khlFit <= 10, `fitted rule: 30-year-old back from the KHL ≤ 10 GP (got ${khlFit.toFixed(1)})`);
}

// A contextual projection (no 10-game NHL season) is re-projected at the
// rule's games, not scaled from totals rounded at 10 games.
const profilesDoc = JSON.parse(
  readFileSync(join(process.cwd(), "src", "data", "player-profiles.json"), "utf8"),
) as { profiles: PlayerProfile[] };
const yakemchuk = profilesDoc.profiles.find((p) => p.id === 8484759);
assert(yakemchuk !== undefined, "Carter Yakemchuk's profile is committed");
if (yakemchuk) {
  const normalized = normalizeProfile(yakemchuk);
  const own = projectSkaterFromProfile(normalized);
  const at40 = projectSkaterFromProfile(normalized, 40);
  assert(own.gamesPlayed === 10 && at40.gamesPlayed === 40, "the override sets the games");
  assert(
    Math.abs(at40.projection.shots - 4 * own.projection.shots) <= 6,
    `rates hold over the override (shots ${own.projection.shots} at 10, ${at40.projection.shots} at 40)`,
  );
  assert(at40.projection.goals >= 1, `no rounding to zero over 40 games (goals ${at40.projection.goals})`);
}

if (failed) process.exit(1);
console.log("OK: split seasons");
