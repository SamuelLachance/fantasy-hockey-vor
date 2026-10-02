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
 * `--league <slug>` re-values another league's snapshot (its own paths,
 * scoring column, priors and plan inputs, as the sync passes them); the
 * dynasty rebuild is then `npm run dynasty:build -- --league <slug>`.
 *
 * Run: npm run league:revalue [-- --league <slug>]
 */
import { existsSync, readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { buildDailyPlan } from "../src/lib/fantrax/daily-plan";
import { bestFpg, seasonFp } from "../src/lib/fantrax/draft-inputs";
import { PLAN_KIT } from "../src/lib/fantrax/plan-kit";
import { leagueVor } from "../src/lib/fantrax/points-vor";
import type { ContractsFile } from "../src/lib/fantrax/salary-cap";
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
import type { PlayerProfile } from "../src/lib/profile-types";
import type { ProjectionsDataset } from "../src/lib/types";
import { writeClientDynasty } from "./dynasty-client";
import { fantraxLeagueArg, fantraxPaths } from "./fantrax-paths";

const CFG = fantraxLeagueArg(process.argv.slice(2), "league:revalue");
const PATHS = fantraxPaths(CFG, process.cwd());
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
  const { record } = valueRecord(league.scoring, { n, t, e, ...(age !== undefined ? { age } : {}) }, proj, profile, CFG);
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
      fp: round(seasonFp(value, CFG), 1),
      fpg: round(rec.pos === "G" ? (value.gE ?? 0) : bestFpg(value, CFG), 2),
      gp: value.gp,
    };
  }),
};

// The same plan inputs as the sync: the league's value model and, for a
// salary-cap league, the committed contracts (the cap line).
const vor = leagueVor(CFG, nextValues.players, (id) => seasonFp(nextValues.players[id]!, CFG), league.slotCounts);
// contracts.json is derived from dynasty.json (not committed): rebuild the
// browser copies first, as the sync does.
if (CFG.salaryCap && existsSync(PATHS.dynasty)) writeClientDynasty(PATHS.dynasty);
const contracts = CFG.salaryCap && existsSync(PATHS.contracts) ? read<ContractsFile>(PATHS.contracts) : null;
if (CFG.salaryCap && !contracts) console.warn("WARN: no contracts.json: the plan carries no cap line");
const plan = buildDailyPlan({
  league,
  state,
  values: nextValues,
  schedule,
  teamId: today.teamId,
  nowMs: Date.parse(today.generatedAt),
  config: CFG,
  vor,
  contracts,
  kit: PLAN_KIT,
});

writeFileAtomic(PATHS.values, `${JSON.stringify(nextValues)}\n`);
writeFileAtomic(PATHS.pool, `${JSON.stringify(nextPool)}\n`);
writeFileAtomic(PATHS.today, `${JSON.stringify(plan)}\n`);
console.log(
  `values: ${Object.keys(players).length} rows re-valued from players.json ${dataset.generatedAt}; ${changed.length} changed${changed.length ? ` (${changed.slice(0, 12).map((id) => players[id]!.n).join(", ")}${changed.length > 12 ? ", …" : ""})` : ""}`,
);
console.log(`Next: npm run dynasty:build${CFG.slug === "captains-dynasty" ? "" : ` -- --league ${CFG.dynastyProfile ?? CFG.slug}`}`);
