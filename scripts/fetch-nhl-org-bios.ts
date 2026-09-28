/**
 * Birth date, entry draft and position of the NHL-organisation players the
 * rest of the repo knows nothing about (`src/data/nhl-org-bios.json`): every
 * player of `src/data/nhl-rosters.json` (rosters, prospect lists, the search
 * index's club players, unsigned draft rights included) who has neither a
 * profile (`player-profiles.json`) nor a line in `league-seasons.json`. The
 * search index gives no birth date, and neither list gives the draft: the
 * Fantrax syncs read this file to match these players (ages), place their
 * NHL draft pick, and value them in the dynasty models.
 *
 * Source: the public NHL player landing (`api-web.nhle.com/v1/player/{id}/landing`),
 * no key, no login. One request at a time, >= 1.1 s apart, a descriptive
 * User-Agent, long back-off on 429 / 5xx. Resumable: players already in the
 * file are skipped (`-- --refresh` refetches them all), and it is rewritten
 * every 100 players. About 1,160 requests (~22 min) the first time, then
 * only the players new to nhl-rosters.json.
 *
 * Run: npm run nhl:org-bios
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { NHL_ORG_BIOS_SCHEMA, parseOrgBio, serializeOrgBios, type NhlOrgBiosFile } from "../src/lib/fantrax/org-players";
import type { NhlRostersFile } from "../src/lib/nhl-rosters";

const ROOT = process.cwd();
const OUT = join(ROOT, "src", "data", "nhl-org-bios.json");
const ROSTERS = join(ROOT, "src", "data", "nhl-rosters.json");
const PROFILES = join(ROOT, "src", "data", "player-profiles.json");
const LEAGUE_SEASONS = join(ROOT, "src", "data", "league-seasons.json");
const USER_AGENT =
  "fantasy-hockey-vor/1.0 (personal fantasy hockey tool, read-only; https://github.com/SamuelLachance/fantasy-hockey-vor)";
const MIN_INTERVAL_MS = 1100;
const SAVE_EVERY = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const readJson = <T>(p: string): T | null => (existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null);

let lastRequestAt = 0;
async function politeFetch(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      res = null;
    }
    if (res && (res.ok || res.status === 404)) return res;
    // 429 / 5xx / network: back off 10 s, 20 s, 40 s…
    await sleep(Math.min(160_000, 10_000 * 2 ** attempt));
  }
  return null;
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  const rosters = readJson<NhlRostersFile>(ROSTERS);
  if (!rosters) throw new Error(`${ROSTERS} missing: run npm run nhl:rosters first`);
  const profiles = new Set((readJson<{ profiles: Array<{ id: number }> }>(PROFILES)?.profiles ?? []).map((p) => p.id));
  const seasons = readJson<{ players: Record<string, unknown> }>(LEAGUE_SEASONS)?.players ?? {};
  const prev = readJson<NhlOrgBiosFile>(OUT);
  const players: NhlOrgBiosFile["players"] = { ...(prev?.schema === NHL_ORG_BIOS_SCHEMA ? prev.players : {}) };
  const wanted = rosters.players.map((p) => p.id).filter((id) => !profiles.has(id) && seasons[String(id)] == null);
  const todo = wanted.filter((id) => refresh || !(String(id) in players));
  console.log(
    `${wanted.length} organisation players without a profile or league-seasons line, ${todo.length} to fetch (~${Math.ceil((todo.length * MIN_INTERVAL_MS) / 60000)} min)`,
  );
  const save = () => {
    const file: NhlOrgBiosFile = {
      schema: NHL_ORG_BIOS_SCHEMA,
      fetchedAt: new Date().toISOString(),
      source: "api-web.nhle.com/v1/player/{id}/landing (birthDate, draftDetails, position), players of nhl-rosters.json without a profile or a league-seasons line",
      players: Object.fromEntries(Object.entries(players).sort((a, b) => Number(a[0]) - Number(b[0]))),
    };
    writeFileAtomic(OUT, serializeOrgBios(file));
  };
  let done = 0;
  let failed = 0;
  for (const id of todo) {
    const res = await politeFetch(`https://api-web.nhle.com/v1/player/${id}/landing`);
    if (!res) failed++;
    else if (res.status === 404) players[String(id)] = null;
    else {
      try {
        players[String(id)] = parseOrgBio(await res.json());
      } catch {
        failed++;
      }
    }
    if (++done % SAVE_EVERY === 0) {
      save();
      console.log(`  ${done}/${todo.length} (${failed} failed)`);
    }
  }
  if (todo.length > 0 || !prev) save();
  console.log(`OK: ${Object.keys(players).length} players in ${OUT} (${failed} failed this run; rerun to retry)`);
}

main().catch((e: unknown) => {
  console.error(`FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
