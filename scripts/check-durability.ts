/** Spot-check derived durability records against known injury cases. */
import { readFileSync } from "fs";
import { join } from "path";
import {
  buildTeamSchedules,
  deriveDurability,
  GAMELOG_CACHE_DIR,
  type SeasonLogCache,
} from "../src/lib/ml/gamelog-durability";

const CASES: { name: string; playerId: number; seasonId: number; note: string }[] = [
  { name: "Crosby", playerId: 8471675, seasonId: 20102011, note: "concussion Jan 5; played 41, missed rest" },
  { name: "Crosby", playerId: 8471675, seasonId: 20112012, note: "played 22 in return season, gaps" },
  { name: "Ovechkin", playerId: 8471214, seasonId: 20102011, note: "played 79, durable" },
  { name: "T.Hall", playerId: 8475791, seasonId: 20192020, note: "traded NJD→ARI mid-season" },
];

for (const c of CASES) {
  const cache = JSON.parse(
    readFileSync(join(GAMELOG_CACHE_DIR, `${c.seasonId}.json`), "utf8"),
  ) as SeasonLogCache;
  const schedules = buildTeamSchedules(cache);
  const games = cache[String(c.playerId)];
  if (!games) {
    console.log(`${c.name} ${c.seasonId}: no log`);
    continue;
  }
  const rec = deriveDurability(games, schedules);
  console.log(`${c.name} ${c.seasonId} (${c.note}):`);
  console.log(`  ${JSON.stringify(rec)}`);
}
