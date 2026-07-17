/**
 * Build prospect-stats.json from NHL player landing seasonTotals (AHL/NCAA/CHL/Europe).
 * Run: npm run prospect:cache
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { fetchJson, type PlayerLanding } from "../src/lib/nhl-api";
import {
  parseSeasonTotals,
  prospectRatesFromSeasons,
  type ProspectCache,
} from "../src/lib/prospect-stats";

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
const OUT = join(process.cwd(), "src", "data", "prospect-stats.json");
const CONCURRENCY = 8;

async function fetchLanding(playerId: number): Promise<PlayerLanding | null> {
  try {
    return await fetchJson<PlayerLanding>(
      `https://api-web.nhle.com/v1/player/${playerId}/landing`,
    );
  } catch {
    return null;
  }
}

async function main() {
  if (!existsSync(PROFILES_PATH)) {
    console.error("player-profiles.json not found — run npm run collect first");
    process.exit(1);
  }
  const bundle = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
    profiles: { id: number; isGoalie: boolean }[];
  };
  const skaterIds = bundle.profiles.filter((p) => !p.isGoalie).map((p) => p.id);
  console.log(`Fetching seasonTotals for ${skaterIds.length} skaters...`);

  const entries: ProspectCache["entries"] = [];
  let done = 0;

  for (let i = 0; i < skaterIds.length; i += CONCURRENCY) {
    const batch = skaterIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (playerId) => {
        const landing = await fetchLanding(playerId);
        if (!landing?.seasonTotals) return null;
        const seasons = parseSeasonTotals(landing.seasonTotals);
        const rates = prospectRatesFromSeasons(seasons);
        if (!rates) return null;
        // Keep raw seasons so lookupProspectRates can apply temporal cutoffs.
        return { playerId, rates, seasons };
      }),
    );
    for (const r of results) {
      if (r) entries.push(r);
    }
    done += batch.length;
    if (done % 100 === 0 || done === skaterIds.length) {
      console.log(`  ${done}/${skaterIds.length} (${entries.length} with prospect data)`);
    }
  }

  const cache: ProspectCache = {
    builtAt: new Date().toISOString(),
    entries,
  };
  writeFileAtomic(OUT, JSON.stringify(cache, null, 2));
  console.log(`Wrote ${entries.length} prospect entries to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
