/**
 * CI guard: validates the committed players.json before the site is built.
 * Run: npx tsx scripts/check-players-data.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ProjectionsDataset } from "../src/lib/types";

const PLAYERS_PATH = join(process.cwd(), "src", "data", "players.json");
const DETAILS_PATH = join(process.cwd(), "public", "player-details.json");
const MIN_PLAYERS = 800;
const STALE_WARN_DAYS = 30;

const errors: string[] = [];
const warnings: string[] = [];

if (!existsSync(PLAYERS_PATH)) {
  console.error("FAIL: src/data/players.json is missing");
  process.exit(1);
}

let data: ProjectionsDataset;
try {
  data = JSON.parse(readFileSync(PLAYERS_PATH, "utf8")) as ProjectionsDataset;
} catch (e) {
  console.error(`FAIL: players.json is not valid JSON: ${e}`);
  process.exit(1);
}

if (!Array.isArray(data.players) || data.players.length < MIN_PLAYERS) {
  errors.push(
    `players array has ${data.players?.length ?? 0} entries (expected >= ${MIN_PLAYERS})`,
  );
}

const generatedAt = new Date(data.generatedAt).getTime();
if (!Number.isFinite(generatedAt)) {
  errors.push(`generatedAt is not a valid date: ${data.generatedAt}`);
} else {
  const ageDays = (Date.now() - generatedAt) / (24 * 60 * 60 * 1000);
  if (ageDays > STALE_WARN_DAYS) {
    warnings.push(`projections are ${ageDays.toFixed(0)} days old`);
  }
}

if (!data.season) errors.push("season is missing");

const players = data.players ?? [];
const badVor = players.filter((p) => !Number.isFinite(p.vor)).length;
if (badVor > 0) errors.push(`${badVor} players with non-finite VOR`);

const badGp = players.filter(
  (p) => !Number.isFinite(p.gamesPlayed) || p.gamesPlayed < 0 || p.gamesPlayed > 82,
).length;
if (badGp > 0) errors.push(`${badGp} players with GP outside 0-82`);

const goalies = players.filter((p) => p.isGoalie).length;
const skaters = players.length - goalies;
if (goalies < 40) errors.push(`only ${goalies} goalies (expected >= 40)`);
if (skaters < 500) errors.push(`only ${skaters} skaters (expected >= 500)`);

const ranks = new Set(players.map((p) => p.rank));
if (ranks.size !== players.length) {
  errors.push("duplicate or missing ranks detected");
}

if (!existsSync(DETAILS_PATH)) {
  errors.push("public/player-details.json is missing (run npm run generate)");
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: ${players.length} players (${skaters} skaters, ${goalies} goalies), generated ${data.generatedAt}`,
);
