/**
 * Per-game box scores of past regular seasons, for the backtests of the
 * matchup simulator (scripts/backtest-matchup.ts) and of the trade evaluator
 * (scripts/backtest-trade.ts). Public, unauthenticated NHL stats REST only
 * (api.nhle.com/stats/rest), one request at a time, >= 1.2 s apart, with a
 * descriptive User-Agent. Every raw answer is cached on disk, so a re-run
 * fetches nothing it already has.
 *
 * Output (in the cache directory):
 *   games-<season>.json  { skaters: SkaterGame[], goalies: GoalieGame[], names }
 *   totals-<season>.json { skaters: SkaterSeason[], goalies: GoalieSeason[] }
 *
 * Usage:
 *   npx tsx scripts/fetch-nhl-game-logs.ts [--cache <dir>] [--games 20232024,20242025] [--totals 20182019,...]
 * The cache defaults to $NHL_STATS_CACHE, else .cache/nhl-stats (gitignored).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { parseArgs } from "util";

const UA = "fantasy-hockey-vor-backtest/1.0 (personal fantasy hockey research; static site, no login)";
const BASE = "https://api.nhle.com/stats/rest/en";
const GAP_MS = 1200;

const { values: args } = parseArgs({
  options: {
    cache: { type: "string" },
    games: { type: "string", default: "20212022,20222023,20232024,20242025,20252026" },
    totals: { type: "string", default: "20182019,20192020,20202021,20212022,20222023,20232024,20242025,20252026" },
  },
});
export const CACHE_DIR = args.cache ?? process.env.NHL_STATS_CACHE ?? join(process.cwd(), ".cache", "nhl-stats");

let last = 0;
async function getJson(url: string, file: string): Promise<{ data: Array<Record<string, unknown>>; total: number }> {
  const raw = join(CACHE_DIR, "raw", file);
  if (existsSync(raw)) return JSON.parse(readFileSync(raw, "utf8"));
  const wait = last + GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  for (let attempt = 0; ; attempt++) {
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = (await res.json()) as { data: Array<Record<string, unknown>>; total: number };
      if (!Array.isArray(j.data)) throw new Error("no data");
      if (j.data.length < j.total) throw new Error(`short page ${j.data.length}/${j.total}`);
      mkdirSync(join(CACHE_DIR, "raw"), { recursive: true });
      writeFileSync(raw, JSON.stringify(j));
      return j;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.warn(`  retry ${file}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, GAP_MS * (attempt + 2)));
    }
  }
}

const url = (report: string, game: boolean, exp: string) =>
  `${BASE}/${report}?isAggregate=false&isGame=${game}&start=0&limit=-1&cayenneExp=${encodeURIComponent(exp)}`;

/** Monday-to-Sunday windows covering the regular season (Oct 1 - Apr 30). */
function weeks(season: number): Array<[string, string]> {
  const y = Math.floor(season / 10000);
  const d = new Date(Date.UTC(y, 9, 1));
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
  const end = Date.UTC(y + 1, 4, 1);
  const out: Array<[string, string]> = [];
  while (d.getTime() < end) {
    const a = d.toISOString().slice(0, 10);
    const e = new Date(d.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    out.push([a, e]);
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** [playerId, date, team, opp, pos, G, A, PPP, SOG, HIT, BLK, TOIs] */
export type SkaterGame = [number, string, string, string, string, number, number, number, number, number, number, number];
/** [playerId, date, team, opp, GS, W, GA, SA, SHO, TOIs] */
export type GoalieGame = [number, string, string, string, number, number, number, number, number, number];

const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

async function seasonGames(season: number): Promise<void> {
  const out = join(CACHE_DIR, `games-${season}.json`);
  if (existsSync(out)) {
    console.log(`games ${season}: cached`);
    return;
  }
  const skaters = new Map<string, SkaterGame>();
  const goalies: GoalieGame[] = [];
  const names: Record<string, string> = {};
  for (const [a, b] of weeks(season)) {
    const exp = `gameDate>="${a}" and gameDate<="${b}" and gameTypeId=2 and seasonId=${season}`;
    const sum = await getJson(url("skater/summary", true, exp), `sum-${season}-${a}.json`);
    const rt = await getJson(url("skater/realtime", true, exp), `rt-${season}-${a}.json`);
    const gk = await getJson(url("goalie/summary", true, exp), `gk-${season}-${a}.json`);
    for (const r of sum.data) {
      const key = `${r.playerId}|${r.gameId}`;
      names[String(r.playerId)] = String(r.skaterFullName ?? "");
      skaters.set(key, [
        n(r.playerId), String(r.gameDate), String(r.teamAbbrev), String(r.opponentTeamAbbrev), String(r.positionCode),
        n(r.goals), n(r.assists), n(r.ppPoints), n(r.shots), 0, 0, n(r.timeOnIcePerGame),
      ]);
    }
    for (const r of rt.data) {
      const row = skaters.get(`${r.playerId}|${r.gameId}`);
      if (row) {
        row[9] = n(r.hits);
        row[10] = n(r.blockedShots);
      }
    }
    for (const r of gk.data) {
      names[String(r.playerId)] = String(r.goalieFullName ?? "");
      goalies.push([
        n(r.playerId), String(r.gameDate), String(r.teamAbbrev), String(r.opponentTeamAbbrev),
        n(r.gamesStarted), n(r.wins), n(r.goalsAgainst), n(r.shotsAgainst), n(r.shutouts), n(r.timeOnIce),
      ]);
    }
    console.log(`games ${season} ${a}: ${sum.data.length} skater rows, ${gk.data.length} goalie rows`);
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(out, JSON.stringify({ season, skaters: [...skaters.values()], goalies, names }));
}

/** [playerId, pos, GP, G, A, PPP, SOG, HIT, BLK, TOI/GP s, age-ish birth year unknown → 0] */
export type SkaterSeason = [number, string, number, number, number, number, number, number, number, number];
/** [playerId, GP, GS, W, GA, SA, SHO, TOIs] */
export type GoalieSeason = [number, number, number, number, number, number, number, number];

async function seasonTotals(season: number): Promise<void> {
  const out = join(CACHE_DIR, `totals-${season}.json`);
  if (existsSync(out)) {
    console.log(`totals ${season}: cached`);
    return;
  }
  const exp = `gameTypeId=2 and seasonId=${season}`;
  const sum = await getJson(url("skater/summary", false, exp), `tsum-${season}.json`);
  const rt = await getJson(url("skater/realtime", false, exp), `trt-${season}.json`);
  const gk = await getJson(url("goalie/summary", false, exp), `tgk-${season}.json`);
  const rtBy = new Map(rt.data.map((r) => [n(r.playerId), r]));
  const names: Record<string, string> = {};
  const skaters: SkaterSeason[] = sum.data.map((r) => {
    const x = rtBy.get(n(r.playerId));
    names[String(r.playerId)] = String(r.skaterFullName ?? "");
    return [
      n(r.playerId), String(r.positionCode), n(r.gamesPlayed), n(r.goals), n(r.assists), n(r.ppPoints), n(r.shots),
      n(x?.hits), n(x?.blockedShots), n(r.timeOnIcePerGame),
    ];
  });
  const goalies: GoalieSeason[] = gk.data.map((r) => {
    names[String(r.playerId)] = String(r.goalieFullName ?? "");
    return [n(r.playerId), n(r.gamesPlayed), n(r.gamesStarted), n(r.wins), n(r.goalsAgainst), n(r.shotsAgainst), n(r.shutouts), n(r.timeOnIce)];
  });
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(out, JSON.stringify({ season, skaters, goalies, names }));
  console.log(`totals ${season}: ${skaters.length} skaters, ${goalies.length} goalies`);
}

async function main() {
  console.log(`cache: ${CACHE_DIR}`);
  for (const s of (args.totals ?? "").split(",").filter(Boolean)) await seasonTotals(Number(s));
  for (const s of (args.games ?? "").split(",").filter(Boolean)) await seasonGames(Number(s));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
