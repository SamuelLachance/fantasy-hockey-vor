/**
 * Refresh `src/data/nhl-rosters.json`: every club's current roster and
 * prospect list from the NHL's public web API (no key, no login), one
 * request at a time, ≥ 1.2 s apart, with a descriptive User-Agent. 64
 * requests (~80 s).
 *
 * The categories league boards read the snapshot (`npm run draft:board`,
 * rebuilt by `build:pages`): players the projections never saw get a
 * « pas de projection » row, and projected players take their current club.
 * The file is only written when every list came back and the rosters hold
 * a plausible number of players, so a flaky run never shrinks the pool.
 *
 * Run: npm run nhl:rosters
 */
import { writeFileAtomic } from "../src/lib/atomic-write";
import { NHL_TEAMS } from "../src/lib/nhl-api";
import {
  mergeNhlLists,
  nhlRostersErrors,
  parseNhlList,
  serializeNhlRosters,
  type NhlListKind,
  type NhlListedPlayer,
  type NhlRostersFile,
} from "../src/lib/nhl-rosters";
import { join } from "path";

const OUT = join(process.cwd(), "src", "data", "nhl-rosters.json");
const BASE = "https://api-web.nhle.com/v1";
const USER_AGENT =
  "fantasy-hockey-vor/1.0 (personal fantasy hockey tool, read-only; https://github.com/SamuelLachance/fantasy-hockey-vor)";
const SPACING_MS = 1200;
const RETRIES = 4;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let lastRequestAt = 0;

async function getJson(url: string): Promise<unknown> {
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const wait = lastRequestAt + SPACING_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
    let res: Response | null = null;
    try {
      res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": USER_AGENT } });
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

async function main() {
  const lists: NhlListedPlayer[][] = [];
  const counts: Record<NhlListKind, number> = { roster: 0, prospect: 0 };
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
  const file: NhlRostersFile = {
    schema: 1,
    fetchedAt: new Date().toISOString(),
    source: "api-web.nhle.com /v1/roster/{club}/current et /v1/prospects/{club}",
    counts,
    players: mergeNhlLists(lists),
  };
  const errors = nhlRostersErrors(file);
  if (errors.length > 0) throw new Error(`snapshot refused: ${errors.slice(0, 10).join("; ")}`);
  writeFileAtomic(OUT, serializeNhlRosters(file));
  const onRoster = file.players.filter((p) => p.list === "roster").length;
  console.log(`${file.players.length} players (${onRoster} on rosters, ${file.players.length - onRoster} prospects only) → ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(`FAIL: ${err instanceof Error ? err.message : String(err)} — ${OUT} left unchanged`);
  process.exit(1);
});
