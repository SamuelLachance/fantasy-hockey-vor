/**
 * Game-by-game history for the in-season backtest (scripts/backtest-in-season.ts):
 * every regular-season game line of every skater and goalie, from the public
 * NHL stats REST (api.nhle.com/stats/rest, isGame=true, month windows split in
 * two while a window holds 10,000 rows or more), plus season aggregates.
 *
 * Per game: skater summary (G, A, PPP, SOG, PIM, TOI), realtime (hits,
 * blocks), faceoff wins, time on ice (EV / PP / SH) and goalie summary
 * (start, W, SO, saves, shots against). Season aggregates (summary, realtime,
 * faceoffs, time on ice, goalie summary, bios) for the priors.
 *
 * Cache: one file per report and season, `nhlstats-<kind>-<report>-<season>-<game|season>.json`
 * in --cache=<dir> (default src/data/ml/gamelog-cache/in-season, gitignored).
 * A cached file is never requested again. Public unauthenticated GETs only,
 * ≥ 1.15 s apart, descriptive User-Agent.
 *
 * Run: npx tsx scripts/fetch-in-season-history.ts [--cache=<dir>] [--game-seasons=20212022,...] [--agg-seasons=...]
 */
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const UA = "fantasy-hockey-vor in-season backtest (personal read-only helper; github.com/SamuelLachance/fantasy-hockey-vor)";
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
export const DEFAULT_CACHE = join(process.cwd(), "src", "data", "ml", "gamelog-cache", "in-season");
const CACHE = arg("cache") ?? process.env.IN_SEASON_CACHE ?? DEFAULT_CACHE;
const GAME_SEASONS = (arg("game-seasons") ?? "20212022,20222023,20232024,20242025,20252026").split(",").filter(Boolean);
const AGG_SEASONS = (arg("agg-seasons") ?? "20172018,20182019,20192020,20202021,20212022,20222023,20232024,20242025,20252026").split(",").filter(Boolean);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function get(url: string): Promise<{ data: unknown[]; total: number }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 1150 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as { data: unknown[]; total: number };
    } catch (err) {
      console.warn(`retry ${attempt + 1}: ${url.slice(0, 140)} (${(err as Error).message})`);
      await sleep(3000 * (attempt + 1));
    }
  }
  throw new Error(`failed: ${url}`);
}
const iso = (d: Date) => d.toISOString().slice(0, 10);

async function windowRows(kind: string, report: string, season: string, from: Date, to: Date): Promise<unknown[]> {
  const exp = encodeURIComponent(`seasonId=${season} and gameTypeId=2 and gameDate>="${iso(from)}" and gameDate<"${iso(to)}"`);
  const j = await get(`https://api.nhle.com/stats/rest/en/${kind}/${report}?isAggregate=false&isGame=true&start=0&limit=-1&cayenneExp=${exp}`);
  if ((j.total >= 10000 || j.data.length < j.total) && to.getTime() - from.getTime() > 86400000) {
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    mid.setUTCHours(0, 0, 0, 0);
    return [...(await windowRows(kind, report, season, from, mid)), ...(await windowRows(kind, report, season, mid, to))];
  }
  return j.data;
}

export async function gameReport(dir: string, kind: string, report: string, season: string): Promise<void> {
  const f = join(dir, `nhlstats-${kind}-${report}-${season}-game.json`);
  if (existsSync(f)) return;
  const y = Number(season.slice(0, 4));
  const rows: unknown[] = [];
  // September (y) .. August (y + 1): also covers the 2019-20 / 2020-21 calendars.
  for (let m = 8; m < 20; m++) {
    const part = await windowRows(kind, report, season, new Date(Date.UTC(y, m, 1)), new Date(Date.UTC(y, m + 1, 1)));
    rows.push(...part);
    if (part.length) console.log(kind, report, season, iso(new Date(Date.UTC(y, m, 1))), part.length);
  }
  writeFileSync(f, JSON.stringify(rows));
}

export async function seasonReport(dir: string, kind: string, report: string, season: string): Promise<void> {
  const f = join(dir, `nhlstats-${kind}-${report}-${season}-season.json`);
  if (existsSync(f)) return;
  const j = await get(
    `https://api.nhle.com/stats/rest/en/${kind}/${report}?isAggregate=false&isGame=false&start=0&limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`,
  );
  console.log(kind, report, season, "season", j.data.length);
  writeFileSync(f, JSON.stringify(j.data));
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  const agg: Array<[string, string]> = [["skater", "summary"], ["skater", "realtime"], ["skater", "faceoffwins"], ["skater", "timeonice"], ["goalie", "summary"], ["skater", "bios"]];
  for (const s of AGG_SEASONS) for (const [k, r] of agg) await seasonReport(CACHE, k, r, s);
  const game: Array<[string, string]> = [["skater", "summary"], ["skater", "realtime"], ["skater", "faceoffwins"], ["skater", "timeonice"], ["goalie", "summary"]];
  for (const s of GAME_SEASONS) for (const [k, r] of game) await gameReport(CACHE, k, r, s);
  console.log(`OK: in-season history cached in ${CACHE}`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("fetch-in-season-history.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
