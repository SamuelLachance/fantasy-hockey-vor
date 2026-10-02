/**
 * CI guard: the pre-season board (src/data/players-preseason.json, the
 * baseline of the daily in-season update) is coherent with the model that
 * produced it and covers today's rosters.
 *
 * - Provenance: generated from the dataset the committed v2 bundle was
 *   trained on (sha1), with the out-of-sample GP calibration (version 2).
 *   The 2026-07-30 board was not: model GP mean 50.6, max 69.
 * - Model GP level: mean 53-62, max ≥ 78 over the v2 skaters.
 * - Rosters: every player on an NHL club's roster (src/data/nhl-rosters.json,
 *   list « roster ») is projected (when the snapshot predates the board).
 * - Iron men (78+ games in each of the last two seasons): group mean
 *   71-77, at most 2 of the 30-and-under below 66 without a split season.
 * - Rookies without a recent NHL game: ≤ 30 games off a club's roster, and
 *   no flat value shared by most of them (the old contextual path: all 62).
 * - Clubs: skater games within 18 × 82 ± 6 % (the ±5 % band and rounding).
 * - Nobody on no club list without an NHL game in two seasons.
 * - Goalie save% spread within the skill ceiling (0.0051).
 * Run: npx tsx scripts/check-preseason.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { CALIBRATED_GP_CEILING } from "../src/lib/gp-calibration";
import { GOALIE_SAVE_PCT_SKILL_SD, GOALIE_SHRINK_MIN_GP } from "../src/lib/leagues/goalie-shrink";
import { NHL_TEAMS } from "../src/lib/nhl-api";
import type { NhlRostersFile } from "../src/lib/nhl-rosters";
import { ROOKIE_OFF_ROSTER_MAX_GP, SKATER_GAMES_PER_TEAM, staleReason } from "../src/lib/projection-pool";
import type { PlayerProfile } from "../src/lib/profile-types";
import type { ProjectionsDataset } from "../src/lib/types";

const root = process.cwd();
const read = <T>(...p: string[]) => JSON.parse(readFileSync(join(root, ...p), "utf8")) as T;
const errors: string[] = [];
const warnings: string[] = [];

const board = read<ProjectionsDataset & { dataManifest?: Record<string, unknown> }>("src", "data", "players-preseason.json");
const bundleHead = readFileSync(join(root, "src", "data", "ml", "v2-bundle.json"), "utf8").slice(0, 600);
const stamp = (k: string) => bundleHead.match(new RegExp(`"${k}"\\s*:\\s*"([^"]+)"`))?.[1] ?? null;
const bundleTrainedAt = stamp("trainedAt");
const bundleSha1 = stamp("datasetSha1");

// Provenance.
const manifest = (board.dataManifest ?? {}) as { dataset?: { sha1?: string } | null; bundleTrainedAt?: string | null };
if (!bundleSha1) errors.push("v2-bundle.json has no datasetSha1 (retrain with npm run ml:train-v2)");
if (!manifest.dataset?.sha1) errors.push("players-preseason.json dataManifest has no dataset sha1 (regenerate with npm run generate)");
else if (bundleSha1 && manifest.dataset.sha1 !== bundleSha1) {
  errors.push(`board generated from dataset ${manifest.dataset.sha1.slice(0, 12)}, bundle trained on ${bundleSha1.slice(0, 12)}`);
}
if (manifest.bundleTrainedAt !== bundleTrainedAt) {
  errors.push(`board generated with bundle ${manifest.bundleTrainedAt}, committed bundle ${bundleTrainedAt}`);
}
if ((board.gpCalibration as { version?: number } | undefined)?.version !== 2) {
  errors.push("board GP calibration is not the out-of-sample one (version 2)");
}

const skaters = board.players.filter((p) => !p.isGoalie);
const v2 = skaters.filter((p) => p.projectionMethod === "ml");
const modelGps = v2.map((p) => p.modelGamesPlayed ?? p.gamesPlayed);
const meanModel = modelGps.reduce((s, x) => s + x, 0) / Math.max(1, modelGps.length);
if (v2.length > 500 && (meanModel < 53 || meanModel > 62 || Math.max(...modelGps) < 78)) {
  errors.push(`v2 model GP mean ${meanModel.toFixed(1)} / max ${Math.max(...modelGps)} (expected 53-62 / ≥ 78): dataset drift?`);
}

// Rosters, stale players, rookies.
const profiles = new Map(read<{ profiles: PlayerProfile[] }>("src", "data", "player-profiles.json").profiles.map((p) => [p.id, p]));
const rostersPath = join(root, "src", "data", "nhl-rosters.json");
if (existsSync(rostersPath)) {
  const rosters = read<NhlRostersFile>("src", "data", "nhl-rosters.json");
  const lists = new Map(rosters.players.map((p) => [p.id, p.list]));
  const onBoard = new Set(board.players.map((p) => p.id));
  const live = existsSync(join(root, "src", "data", "players.json"))
    ? new Set(read<ProjectionsDataset>("src", "data", "players.json").players.map((p) => p.id))
    : new Set<number>();
  const missing = rosters.players.filter((p) => p.list === "roster" && !onBoard.has(p.id) && !live.has(p.id));
  if (missing.length > 0) {
    const msg = `${missing.length} player(s) on an NHL roster without a projection: ${missing.slice(0, 8).map((p) => `${p.name} (${p.team})`).join(", ")} — npm run collect:missing, then npm run generate`;
    if (Date.parse(rosters.fetchedAt) <= Date.parse(board.generatedAt)) errors.push(msg);
    else warnings.push(`${msg} (roster snapshot newer than the board)`);
  }
  const lastTwo = [20252026, 20242025] as const;
  const stale = board.players.filter((p) => staleReason(p.id, lists, profiles.get(p.id), lastTwo));
  if (stale.length > 0) {
    errors.push(`${stale.length} projected player(s) on no club list without an NHL game in two seasons: ${stale.slice(0, 6).map((p) => p.name).join(", ")}`);
  }
  const rookies = skaters.filter(
    (p) => p.projectionMethod === "contextual" && !p.availability && !profiles.get(p.id)?.teamHistory.some((h) => !h.isGoalie && h.gamesPlayed > 0),
  );
  const offRoster = rookies.filter((p) => lists.get(p.id) !== "roster" && p.gamesPlayed > ROOKIE_OFF_ROSTER_MAX_GP);
  if (offRoster.length > 0) {
    errors.push(`${offRoster.length} rookie(s) off a club's roster above ${ROOKIE_OFF_ROSTER_MAX_GP} GP: ${offRoster.slice(0, 6).map((p) => `${p.name} ${p.gamesPlayed}`).join(", ")}`);
  }
  if (rookies.length >= 10) {
    const counts = new Map<number, number>();
    for (const p of rookies) counts.set(p.gamesPlayed, (counts.get(p.gamesPlayed) ?? 0) + 1);
    const [flat, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
    if (n > rookies.length / 2) errors.push(`${n}/${rookies.length} rookies share ${flat} GP (flat contextual prior)`);
  }
}

// Iron men.
{
  const gpIn = (id: number, s: number) =>
    (profiles.get(id)?.teamHistory ?? []).filter((h) => !h.isGoalie && h.seasonId === s).reduce((a, h) => a + h.gamesPlayed, 0);
  const iron = v2.filter((p) => gpIn(p.id, 20242025) >= 78 && gpIn(p.id, 20252026) >= 78);
  if (iron.length >= 30) {
    const mean = iron.reduce((s, p) => s + p.gamesPlayed, 0) / iron.length;
    if (mean < 71 || mean > 77) errors.push(`iron men (n ${iron.length}) average ${mean.toFixed(1)} GP (expected 71-77)`);
    const low = iron.filter((p) => (profiles.get(p.id)?.bio.ageAtSeasonStart ?? 99) <= 30 && p.gamesPlayed < 66 && !p.availability);
    if (low.length > 2) errors.push(`${low.length} iron men aged 30 or less under 66 GP: ${low.map((p) => `${p.name} ${p.gamesPlayed}`).join(", ")}`);
    else if (low.length > 0) warnings.push(`iron men aged 30 or less under 66 GP (model's call): ${low.map((p) => `${p.name} ${p.gamesPlayed}`).join(", ")}`);
  }
}

// Club skater-games budget.
{
  const teams = new Set<string>(NHL_TEAMS);
  const sums = new Map<string, number>();
  for (const p of skaters) if (teams.has(p.team)) sums.set(p.team, (sums.get(p.team) ?? 0) + p.gamesPlayed);
  const off = [...sums.entries()].filter(([, s]) => Math.abs(s / SKATER_GAMES_PER_TEAM - 1) > 0.06);
  if (off.length > 0) errors.push(`club skater games outside 18 × 82 ± 6 %: ${off.map(([t, s]) => `${t} ${s}`).join(", ")}`);
  const over = skaters.filter((p) => p.gamesPlayed > CALIBRATED_GP_CEILING && !p.availability);
  if (over.length > 0) errors.push(`${over.length} skater(s) above the ${CALIBRATED_GP_CEILING}-GP ceiling`);
}

// Goalie save% spread: at most the skill a three-season history can show
// (src/lib/leagues/goalie-shrink.ts); the board spread 0.0096 before, for an
// out-of-sample R² of −0.62.
{
  const sv = board.players
    .filter((p) => p.isGoalie && p.gamesPlayed >= GOALIE_SHRINK_MIN_GP)
    .map((p) => (p.projection as { savePct: number }).savePct);
  if (sv.length >= 20) {
    const m = sv.reduce((s, x) => s + x, 0) / sv.length;
    const sd = Math.sqrt(sv.reduce((s, x) => s + (x - m) ** 2, 0) / (sv.length - 1));
    if (sd > GOALIE_SAVE_PCT_SKILL_SD) errors.push(`goalie save% spread ${sd.toFixed(4)} above the skill ceiling ${GOALIE_SAVE_PCT_SKILL_SD}`);
  }
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}
console.log(`OK: pre-season board coherent (${board.players.length} players, v2 model GP mean ${meanModel.toFixed(1)}, dataset ${manifest.dataset?.sha1?.slice(0, 12)})`);
