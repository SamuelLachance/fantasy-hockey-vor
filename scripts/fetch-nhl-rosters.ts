/**
 * Refresh `src/data/nhl-rosters.json`: every club's current roster and
 * prospect list from the NHL's public web API (no key, no login), then the
 * NHL's public player search index for everyone else it ties to a club (the
 * prospect lists are empty or thin for some clubs: DET, UTA and VAN came
 * back empty in September 2026). One request at a time, ≥ 1.2 s apart, with
 * a descriptive User-Agent: 65 requests (~80 s; the index is one ~9 MB
 * response).
 *
 * The categories league boards read the snapshot (`npm run draft:board`,
 * rebuilt by `build:pages`): players the projections never saw get a
 * « pas de projection » row, and projected players take their current club.
 * The file is only written when every club list came back and the rosters
 * hold a plausible number of players, so a flaky run never shrinks the
 * pool. A failed or implausible index keeps the previous snapshot's « org »
 * rows (warned). Clubs whose prospect list looks thin are warned too
 * (`::warning::`, an annotation in GitHub Actions).
 *
 * Run: npm run nhl:rosters
 */
import { existsSync, readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { NHL_TEAMS } from "../src/lib/nhl-api";
import {
  mergeNhlLists,
  nhlRostersErrors,
  parseNhlList,
  parseNhlSearchIndex,
  serializeNhlRosters,
  THIN_PROSPECT_LIST,
  thinProspectClubs,
  type NhlListKind,
  type NhlListedPlayer,
  type NhlRostersFile,
} from "../src/lib/nhl-rosters";
import { join } from "path";

const OUT = join(process.cwd(), "src", "data", "nhl-rosters.json");
const BASE = "https://api-web.nhle.com/v1";
/** Every player the index knows (~24,000, ~9 MB); rows without a club are dropped. */
const SEARCH_INDEX = "https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=40000&q=*";
/** Fewer index players with a club than this: a truncated or broken answer. */
const MIN_INDEX_CLUB_PLAYERS = 1500;
const USER_AGENT =
  "fantasy-hockey-vor/1.0 (personal fantasy hockey tool, read-only; https://github.com/SamuelLachance/fantasy-hockey-vor)";
const SPACING_MS = 1200;
const RETRIES = 4;
const TIMEOUT_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const wait = lastRequestAt + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      res = null;
    }
    if (res?.ok) return res.json();
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (!retryable || attempt === RETRIES - 1) throw new Error(`${url}: ${res ? `HTTP ${res.status}` : "network error"}`);
    // Back off well past the spacing (a 429 means we were too eager).
    await sleep(5000 * 2 ** attempt);
  }
  throw new Error(`${url}: failed`);
}

/** The index's club players, or the previous snapshot's « org » rows when it fails. */
async function organisationRows(): Promise<NhlListedPlayer[]> {
  try {
    const rows = parseNhlSearchIndex(await getJson(SEARCH_INDEX));
    if (rows.length < MIN_INDEX_CLUB_PLAYERS) throw new Error(`only ${rows.length} players with a club`);
    return rows;
  } catch (err) {
    let previous: NhlListedPlayer[] = [];
    try {
      if (existsSync(OUT)) {
        const old = JSON.parse(readFileSync(OUT, "utf8")) as Partial<NhlRostersFile>;
        previous = (old.players ?? []).filter((p) => p.list === "org");
      }
    } catch {
      previous = [];
    }
    console.log(
      `::warning::NHL search index unusable (${err instanceof Error ? err.message : String(err)}): keeping the previous snapshot's ${previous.length} organisation players`,
    );
    return previous;
  }
}

async function main() {
  const lists: NhlListedPlayer[][] = [];
  const counts: Record<NhlListKind, number> = { roster: 0, prospect: 0, org: 0 };
  for (const team of NHL_TEAMS) {
    for (const [kind, path] of [
      ["roster", `roster/${team}/current`],
      ["prospect", `prospects/${team}`],
    ] as const) {
      const rows = parseNhlList(await getJson(`${BASE}/${path}`), team, kind);
      if (kind === "roster" && rows.length < 15) throw new Error(`${team}: only ${rows.length} players on the roster`);
      counts[kind] += rows.length;
      lists.push(rows);
      console.log(`${team} ${kind.padEnd(8)} ${rows.length}`);
    }
  }
  const org = await organisationRows();
  const players = mergeNhlLists([...lists, org]);
  counts.org = players.filter((p) => p.list === "org").length;
  console.log(`search index: ${org.length} players with a club, ${counts.org} on neither list`);
  const thin = thinProspectClubs(players);
  if (thin.length > 0) {
    console.log(
      `::warning::thin NHL prospect lists (< ${THIN_PROSPECT_LIST} players): ${thin.join(", ")} — their other organisation players come from the search index`,
    );
  }
  const file: NhlRostersFile = {
    schema: 1,
    fetchedAt: new Date().toISOString(),
    source:
      "api-web.nhle.com /v1/roster/{club}/current et /v1/prospects/{club}, puis l’index de recherche search.d3.nhle.com (club de chaque joueur)",
    counts,
    players,
  };
  const errors = nhlRostersErrors(file);
  if (errors.length > 0) throw new Error(`snapshot refused: ${errors.slice(0, 10).join("; ")}`);
  writeFileAtomic(OUT, serializeNhlRosters(file));
  const n = (k: NhlListKind) => file.players.filter((p) => p.list === k).length;
  console.log(
    `${file.players.length} players (${n("roster")} on rosters, ${n("prospect")} on prospect lists only, ${n("org")} in an organisation only) → ${OUT}`,
  );
}

main().catch((err: unknown) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)} — ${OUT} left unchanged`);
  process.exit(1);
});
