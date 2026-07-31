/**
 * Remove curated inactive IDs from players.json, re-rank, prune details.
 * Run: npx tsx scripts/drop-inactive-players.ts
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { filterActivePlayers } from "../src/lib/inactive-players";
import type { ProjectionsDataset } from "../src/lib/types";

const PLAYERS_PATH = join(process.cwd(), "src", "data", "players.json");
const DETAILS_PATH = join(process.cwd(), "public", "player-details.json");

const data = JSON.parse(readFileSync(PLAYERS_PATH, "utf8")) as ProjectionsDataset;
const before = data.players.length;
const kept = filterActivePlayers(data.players);
kept.sort((a, b) => b.vor - a.vor);
for (let i = 0; i < kept.length; i++) {
  kept[i]!.rank = i + 1;
}
data.players = kept;
writeFileSync(PLAYERS_PATH, JSON.stringify(data));
console.log(`players.json: ${before} → ${kept.length}`);

if (existsSync(DETAILS_PATH)) {
  const details = JSON.parse(readFileSync(DETAILS_PATH, "utf8")) as Record<
    string,
    unknown
  >;
  const idSet = new Set(kept.map((p) => String(p.id)));
  let removed = 0;
  for (const key of Object.keys(details)) {
    if (!idSet.has(key)) {
      delete details[key];
      removed++;
    }
  }
  writeFileSync(DETAILS_PATH, JSON.stringify(details));
  console.log(`player-details.json: pruned ${removed} records`);
}
