/**
 * Build src/data/league-seasons.json: per player and season, NHL games (with
 * average TOI) and games in every other league, from the public NHL player
 * landing (`https://api-web.nhle.com/v1/player/{id}/landing`, `seasonTotals`).
 *
 * Players: every NHL id of the ML history (src/data/ml/durability.json, the
 * 2005-06 → last-season game logs) and of the current profiles
 * (src/data/player-profiles.json), current profiles first.
 *
 * Polite by construction: one request at a time, at most one per 1.1 s, a
 * descriptive User-Agent, long back-off on 429 / 5xx. Resumable: players
 * already in the cache are skipped (`-- --refresh` refetches them all,
 * `-- --only <id,id>` fetches just those), and the file is rewritten every
 * 100 players. No login, public endpoint only.
 *
 * Then, offline, the committed profiles get their games in other leagues
 * and a re-read injury profile (`-- --no-profiles` skips it): a split season
 * is not an injury (src/lib/split-season.ts).
 *
 * Run: npm run collect:leagues
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { otherLeaguesFromLines } from "../src/lib/split-season";
import {
  LEAGUE_SEASONS_PATH,
  parseLeagueSeasonTotals,
  type LeagueSeasonsCache,
  type LeagueSeasonsPlayer,
} from "../src/lib/league-seasons";
import { buildContextNarrative, buildInjuryProfile } from "../src/lib/player-profile";
import type { PlayerProfile } from "../src/lib/profile-types";

const ROOT = process.cwd();
const DURABILITY = join(ROOT, "src", "data", "ml", "durability.json");
const PROFILES = join(ROOT, "src", "data", "player-profiles.json");
const USER_AGENT =
  "fantasy-hockey-vor/0.1 (personal fantasy hockey projections; https://github.com/SamuelLachance/fantasy-hockey-vor)";
const MIN_INTERVAL_MS = 1100;
const SAVE_EVERY = 100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function candidateIds(): number[] {
  const profiles =
    readJson<{
      profiles: Array<{ id: number }> | Record<string, { id: number }>;
    }>(PROFILES)?.profiles ?? [];
  const profileIds = Object.values(profiles).map((p) => p.id);
  const durability =
    readJson<{ byKey: Record<string, unknown> }>(DURABILITY)?.byKey ?? {};
  const historyIds = Object.keys(durability).map((k) => Number(k.split(":")[0]));
  const seen = new Set<number>();
  const out: number[] = [];
  for (const id of [...profileIds, ...historyIds]) {
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function playerFromLanding(landing: Record<string, unknown>): LeagueSeasonsPlayer {
  const draft = landing.draftDetails as
    | { overallPick?: number; year?: number }
    | undefined;
  return {
    pos: String(landing.position ?? ""),
    birth: String(landing.birthDate ?? ""),
    draft: typeof draft?.overallPick === "number" ? draft.overallPick : null,
    draftYear: typeof draft?.year === "number" ? draft.year : null,
    seasons: parseLeagueSeasonTotals(landing.seasonTotals),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const refresh = args.includes("--refresh");
  const onlyIdx = args.indexOf("--only");
  const only =
    onlyIdx >= 0
      ? (args[onlyIdx + 1] ?? "").split(",").map(Number).filter(Number.isFinite)
      : null;

  const existing = readJson<LeagueSeasonsCache>(LEAGUE_SEASONS_PATH);
  const players: LeagueSeasonsCache["players"] = { ...(existing?.players ?? {}) };
  const ids = only ?? candidateIds();
  const todo = ids.filter((id) => refresh || only || !(String(id) in players));
  console.log(
    `${ids.length} players, ${todo.length} to fetch (~${Math.ceil((todo.length * MIN_INTERVAL_MS) / 60000)} min at one request per ${MIN_INTERVAL_MS} ms)`,
  );

  const save = () => {
    const sorted = Object.fromEntries(
      Object.entries(players).sort(([a], [b]) => Number(a) - Number(b)),
    );
    const out: LeagueSeasonsCache = {
      builtAt: new Date().toISOString(),
      source:
        "api-web.nhle.com/v1/player/{id}/landing seasonTotals (regular season, 2000-01 on)",
      players: sorted,
    };
    writeFileAtomic(LEAGUE_SEASONS_PATH, JSON.stringify(out));
  };

  let done = 0;
  let failed = 0;
  for (const id of todo) {
    const res = await politeFetch(`https://api-web.nhle.com/v1/player/${id}/landing`);
    if (!res) {
      failed++;
    } else if (res.status === 404) {
      players[String(id)] = null;
    } else {
      try {
        players[String(id)] = playerFromLanding(
          (await res.json()) as Record<string, unknown>,
        );
      } catch {
        failed++;
      }
    }
    done++;
    if (done % SAVE_EVERY === 0) {
      save();
      console.log(`  ${done}/${todo.length} (${failed} failed)`);
    }
  }
  if (todo.length > 0) {
    save();
    console.log(
      `Wrote ${Object.keys(players).length} players to ${LEAGUE_SEASONS_PATH} (${failed} failed this run; rerun to retry)`,
    );
  }
  if (!args.includes("--no-profiles")) applyToProfiles(players);
}

/**
 * Offline: re-read the committed profiles' injury profile and narrative
 * with their club games outside the NHL, so a split season stops reading as
 * an injury in player-profiles.json itself. The games stay in the cache
 * (`normalizeProfile` backfills `otherLeagues` from it, as generate does);
 * profiles whose injury profile does not change are left byte for byte.
 */
function applyToProfiles(players: LeagueSeasonsCache["players"]) {
  const file = readJson<{ collectedAt: string; count: number; profiles: PlayerProfile[] }>(PROFILES);
  if (!file) return;
  let updated = 0;
  for (const profile of file.profiles) {
    const cached = players[String(profile.id)];
    if (!cached) continue;
    const otherLeagues =
      profile.otherLeagues ??
      otherLeaguesFromLines(cached.seasons, profile.teamHistory.map((s) => s.seasonId));
    const injury = buildInjuryProfile(profile.teamHistory, profile.isGoalie, otherLeagues);
    if (JSON.stringify(injury) === JSON.stringify(profile.injury)) continue;
    profile.injury = injury;
    profile.contextNarrative = buildContextNarrative(profile);
    updated++;
  }
  if (updated === 0) return;
  writeFileAtomic(PROFILES, JSON.stringify(file, null, 2));
  console.log(`Profiles: ${updated} injury profiles re-read with their games in other leagues`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
