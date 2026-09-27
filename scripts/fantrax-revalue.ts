/**
 * Re-value the committed Captains Dynasty snapshot from the current
 * src/data/players.json, without a network sync: after `gp:recalibrate`,
 * `rates:recalibrate` or `vor:reapply`, when the Fantrax side should follow
 * the new projections but the league itself (rosters, flags, ADP, draft)
 * should stay the one of the last sync.
 *
 * Same numbers as `npm run league:sync` for the same players.json (the rows
 * come from src/lib/fantrax/values-build.ts, shared with the sync); on an
 * unchanged players.json it rewrites the committed files byte for byte.
 * Rewrites public/fantrax/values.json (every projected row, goalie start
 * shares, projectionsAt), the projected rows of public/fantrax/pool.json
 * (fp, fpg, gp) and src/data/fantrax/today.json (the plan at the sync's
 * time), then `npm run dynasty:build` rebuilds the dynasty values.
 * Rows, identities, ages and every Fantrax field are kept as synced.
 *
 * Run: npm run league:revalue
 */
import { readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildDailyPlan } from "../src/lib/fantrax/daily-plan";
import { bestFpg, seasonFp } from "../src/lib/fantrax/draft-inputs";
import type { PoolSnapshot } from "../src/lib/fantrax/pool";
import type {
  LeagueSnapshot,
  NhlIdsSnapshot,
  ScheduleSnapshot,
  StateSnapshot,
  ValueRecord,
  ValuesSnapshot,
} from "../src/lib/fantrax/snapshot-types";
import { attachGoalieStartShares, valueRecord } from "../src/lib/fantrax/values-build";
import { NHL_SEASON_ID } from "../src/lib/fantrax/config";
import type { PlayerProfile } from "../src/lib/profile-types";
import type { ProjectionsDataset } from "../src/lib/types";

const ROOT = process.cwd();
const PATHS = {
  league: join(ROOT, "src", "data", "fantrax", "league.json"),
  nhlIds: join(ROOT, "src", "data", "fantrax", "nhl-ids.json"),
  today: join(ROOT, "src", "data", "fantrax", "today.json"),
  values: join(ROOT, "public", "fantrax", "values.json"),
  state: join(ROOT, "public", "fantrax", "state.json"),
  pool: join(ROOT, "public", "fantrax", "pool.json"),
  schedule: join(ROOT, "public", "fantrax", `schedule-${NHL_SEASON_ID}.json`),
  players: join(ROOT, "src", "data", "players.json"),
  profiles: join(ROOT, "src", "data", "player-profiles.json"),
};
const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

const league = read<LeagueSnapshot>(PATHS.league);
const nhlIds = read<NhlIdsSnapshot>(PATHS.nhlIds).ids;
const values = read<ValuesSnapshot>(PATHS.values);
const state = read<StateSnapshot>(PATHS.state);
const pool = read<PoolSnapshot>(PATHS.pool);
const schedule = read<ScheduleSnapshot>(PATHS.schedule);
const today = read<{ teamId: string; generatedAt: string }>(PATHS.today);
const dataset = read<ProjectionsDataset>(PATHS.players);
const profiles = read<{ profiles: PlayerProfile[] }>(PATHS.profiles).profiles;
const board = new Map(dataset.players.map((p) => [p.id, p]));
const profileById = new Map(profiles.map((p) => [p.id, p]));

const players: Record<string, ValueRecord> = {};
const changed: string[] = [];
for (const [fid, row] of Object.entries(values.players)) {
  const nhlId = nhlIds[fid];
  const proj = nhlId !== undefined ? board.get(nhlId) : undefined;
  const profile = nhlId !== undefined ? profileById.get(nhlId) : undefined;
  const { n, t, e, age } = row;
  const { record } = valueRecord(league.scoring, { n, t, e, ...(age !== undefined ? { age } : {}) }, proj, profile);
  players[fid] = record;
}
attachGoalieStartShares(players, (id) => state.icons[id]);
for (const [fid, row] of Object.entries(players)) {
  if (JSON.stringify(row) !== JSON.stringify(values.players[fid])) changed.push(fid);
}

const nextValues: ValuesSnapshot = {
  ...values,
  projectionsAt: dataset.generatedAt,
  players: Object.fromEntries(Object.entries(players).sort((a, b) => a[0].localeCompare(b[0]))),
};

const nextPool: PoolSnapshot = {
  ...pool,
  projectionsAt: dataset.generatedAt,
  players: pool.players.map((rec) => {
    const value = nextValues.players[rec.id];
    if (rec.src !== "p" || value?.src !== "proj") return rec;
    return {
      ...rec,
      fp: round(seasonFp(value), 1),
      fpg: round(rec.pos === "G" ? (value.gE ?? 0) : bestFpg(value), 2),
      gp: value.gp,
    };
  }),
};

const plan = buildDailyPlan({
  league,
  state,
  values: nextValues,
  schedule,
  teamId: today.teamId,
  nowMs: Date.parse(today.generatedAt),
});

writeFileAtomic(PATHS.values, `${JSON.stringify(nextValues)}\n`);
writeFileAtomic(PATHS.pool, `${JSON.stringify(nextPool)}\n`);
writeFileAtomic(PATHS.today, `${JSON.stringify(plan)}\n`);
console.log(
  `values: ${Object.keys(players).length} rows re-valued from players.json ${dataset.generatedAt}; ${changed.length} changed${changed.length ? ` (${changed.slice(0, 12).map((id) => players[id]!.n).join(", ")}${changed.length > 12 ? ", …" : ""})` : ""}`,
);
console.log("Next: npm run dynasty:build");
