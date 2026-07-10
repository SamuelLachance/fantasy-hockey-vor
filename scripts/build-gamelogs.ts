/**
 * Collect per-player game logs for every player-season in the ML dataset and
 * derive the durability registry (injury spells, scratches, roster windows).
 *
 * Resumable: raw logs cache per season in src/data/ml/gamelog-cache/ (gitignored);
 * already-cached players are skipped. Derived output: src/data/ml/durability.json.
 *
 * Usage: npx tsx scripts/build-gamelogs.ts [--season=20232024] [--derive-only]
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { fetchJson } from "../src/lib/nhl-api";
import {
  buildTeamSchedules,
  deriveDurability,
  durabilityKey,
  DURABILITY_PATH,
  GAMELOG_CACHE_DIR,
  type DurabilityRegistry,
  type RawGameEntry,
  type SeasonLogCache,
} from "../src/lib/ml/gamelog-durability";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");
const CONCURRENCY = 6;
const CHUNK_DELAY_MS = 120;

interface GameLogResponse {
  gameLog?: { gameDate?: string; teamAbbrev?: string }[];
}

function cachePath(seasonId: number): string {
  return join(GAMELOG_CACHE_DIR, `${seasonId}.json`);
}

function loadSeasonCache(seasonId: number): SeasonLogCache {
  const p = cachePath(seasonId);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as SeasonLogCache;
  } catch {
    return {};
  }
}

async function fetchPlayerSeasonLog(
  playerId: number,
  seasonId: number,
): Promise<RawGameEntry[]> {
  const url = `https://api-web.nhle.com/v1/player/${playerId}/game-log/${seasonId}/2`;
  const json = await fetchJson<GameLogResponse>(url);
  const games = json.gameLog ?? [];
  const out: RawGameEntry[] = [];
  for (const g of games) {
    if (g.gameDate && g.teamAbbrev) out.push({ d: g.gameDate, t: g.teamAbbrev });
  }
  out.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out;
}

async function collectSeason(
  seasonId: number,
  playerIds: number[],
): Promise<SeasonLogCache> {
  const cache = loadSeasonCache(seasonId);
  const missing = playerIds.filter((id) => !(String(id) in cache));
  if (missing.length === 0) {
    console.log(`  ${seasonId}: all ${playerIds.length} players cached`);
    return cache;
  }
  console.log(
    `  ${seasonId}: fetching ${missing.length} logs (${playerIds.length - missing.length} cached)`,
  );

  let done = 0;
  let sinceWrite = 0;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const chunk = missing.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      chunk.map(async (id) => {
        try {
          return { id, games: await fetchPlayerSeasonLog(id, seasonId) };
        } catch (e) {
          console.warn(
            `    ${seasonId}/${id}: ${e instanceof Error ? e.message : e}`,
          );
          return { id, games: null };
        }
      }),
    );
    for (const r of results) {
      if (r.games !== null) {
        cache[String(r.id)] = r.games;
        sinceWrite++;
      }
    }
    done += chunk.length;
    if (sinceWrite >= 100) {
      writeFileAtomic(cachePath(seasonId), JSON.stringify(cache));
      sinceWrite = 0;
    }
    if (done % 500 === 0 || done === missing.length) {
      console.log(`    ${seasonId}: ${done}/${missing.length}`);
    }
    await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS));
  }
  writeFileAtomic(cachePath(seasonId), JSON.stringify(cache));
  return cache;
}

async function main() {
  const seasonArg = process.argv.find((a) => a.startsWith("--season="));
  const deriveOnly = process.argv.includes("--derive-only");

  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const pairs = new Map<number, Set<number>>(); // seasonId → playerIds
  for (const row of dataset.rows) {
    let set = pairs.get(row.seasonId);
    if (!set) {
      set = new Set();
      pairs.set(row.seasonId, set);
    }
    set.add(row.playerId);
  }

  let seasons = [...pairs.keys()].sort();
  if (seasonArg) {
    const s = Number(seasonArg.split("=")[1]);
    seasons = seasons.filter((x) => x === s);
  }
  const totalPairs = seasons.reduce((n, s) => n + (pairs.get(s)?.size ?? 0), 0);
  console.log(
    `${seasons.length} seasons, ${totalPairs} player-season logs${deriveOnly ? " (derive-only)" : ""}`,
  );

  mkdirSync(GAMELOG_CACHE_DIR, { recursive: true });

  const registry: DurabilityRegistry = {
    builtAt: new Date().toISOString(),
    byKey: {},
  };

  for (const seasonId of seasons) {
    const ids = [...(pairs.get(seasonId) ?? [])];
    const cache = deriveOnly
      ? loadSeasonCache(seasonId)
      : await collectSeason(seasonId, ids);

    const schedules = buildTeamSchedules(cache);
    let derived = 0;
    for (const id of ids) {
      const games = cache[String(id)];
      if (!games || games.length === 0) continue;
      const rec = deriveDurability(games, schedules);
      if (rec) {
        registry.byKey[durabilityKey(id, seasonId)] = rec;
        derived++;
      }
    }
    const schedLens = [...schedules.values()].map((s) => s.length);
    const maxSched = schedLens.length > 0 ? Math.max(...schedLens) : 0;
    console.log(
      `  ${seasonId}: derived ${derived}/${ids.length} (teams=${schedules.size}, max team games=${maxSched})`,
    );
  }

  writeFileAtomic(DURABILITY_PATH, JSON.stringify(registry));
  console.log(
    `wrote ${Object.keys(registry.byKey).length} durability records to ${DURABILITY_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
