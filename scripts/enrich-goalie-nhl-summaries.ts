/**
 * Patch existing ML dataset goalie rows with NHL summary extras
 * (gamesStarted, shotsAgainst, TOI, GAA, losses) without a full rebuild.
 *
 * Usage: npx tsx scripts/enrich-goalie-nhl-summaries.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { fetchGoalieSummaries } from "../src/lib/nhl-api";
import type { MlDataset } from "../src/lib/ml/types";

const DATA_PATH = join(process.cwd(), "src", "data", "ml", "dataset.json");

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

async function main() {
  const dataset = JSON.parse(readFileSync(DATA_PATH, "utf8")) as MlDataset;
  const seasonIds = [...new Set(dataset.rows.filter((r) => r.isGoalie).map((r) => r.seasonId))].sort();
  console.log(`Enriching goalie NHL summaries for ${seasonIds.length} seasons...`);

  let patched = 0;
  let seasonsOk = 0;
  for (const seasonId of seasonIds) {
    try {
      const goalies = await fetchGoalieSummaries(seasonId);
      const byId = new Map(goalies.map((g) => [g.playerId, g]));
      let n = 0;
      for (const row of dataset.rows) {
        if (!row.isGoalie || row.seasonId !== seasonId) continue;
        const g = byId.get(row.playerId);
        if (!g) continue;
        row.gamesStarted = finite(g.gamesStarted);
        row.shotsAgainst = finite(g.shotsAgainst);
        row.goalsAgainst = finite(g.goalsAgainst);
        row.timeOnIceSeconds = finite(g.timeOnIce);
        row.goalsAgainstAverage = finite(g.goalsAgainstAverage);
        row.losses = finite(g.losses);
        // Prefer NHL official SA when present; keep saves/sv% from existing row.
        if (row.shotsAgainst > 0 && row.saves > 0) {
          const sv = row.saves / row.shotsAgainst;
          if (sv > 0.8 && sv < 0.99) row.savePct = sv;
        }
        n++;
        patched++;
      }
      seasonsOk++;
      console.log(`  ${seasonId}: patched ${n} goalies (${goalies.length} from NHL)`);
    } catch (e) {
      console.warn(
        `  ${seasonId}: skipped (${e instanceof Error ? e.message : e})`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  dataset.builtAt = new Date().toISOString();
  writeFileAtomic(DATA_PATH, JSON.stringify(dataset));
  console.log(
    `Done: ${patched} goalie-seasons across ${seasonsOk}/${seasonIds.length} seasons → ${DATA_PATH}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
