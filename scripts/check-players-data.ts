/**
 * CI guard: validates the committed players.json before the site is built.
 * Run: npx tsx scripts/check-players-data.ts
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  findOverloadedGoalieTeams,
  findUnderloadedGoalieTeams,
  topGoalieGpTooLow,
} from "../src/lib/goalie-tandem-guards";
import type { ProjectionsDataset } from "../src/lib/types";

const PLAYERS_PATH = join(process.cwd(), "src", "data", "players.json");
const DETAILS_PATH = join(process.cwd(), "public", "player-details.json");
const MIN_PLAYERS = 800;
const STALE_WARN_DAYS = 30;
const STALE_FAIL_DAYS = 60;

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
  if (ageDays > STALE_FAIL_DAYS) {
    errors.push(
      `projections are ${ageDays.toFixed(0)} days old (fail after ${STALE_FAIL_DAYS}d) — regenerate before deploy`,
    );
  } else if (ageDays > STALE_WARN_DAYS) {
    warnings.push(`projections are ${ageDays.toFixed(0)} days old`);
  }
}

if (!data.season) errors.push("season is missing");

if (
  data.projectionEngine &&
  !["stacked-ensemble", "hybrid-ml-contextual", "ml-timeseries"].includes(
    data.projectionEngine,
  )
) {
  warnings.push(
    `projectionEngine is "${data.projectionEngine}" (expected stacked-ensemble for published ranks)`,
  );
}

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

const overallOne = players.find((p) => p.rank === 1);
if (overallOne?.isGoalie) {
  errors.push(
    `rank #1 is goalie ${overallOne.name} — skater scarcity should lead overall VOR`,
  );
}

const dWithFow = players.filter((p) => {
  if (p.position !== "D" || p.isGoalie) return false;
  const fow = (p.projection as { faceoffWins?: number }).faceoffWins ?? 0;
  return fow > 0;
}).length;
if (dWithFow > 0) {
  errors.push(`${dWithFow} defensemen have FOW > 0`);
}

// Top-3 goalies per team should fit a season; depth chart fillers may add ~4 GP each.
const goaliesByTeam = new Map<string, number[]>();
for (const p of players) {
  if (!p.isGoalie) continue;
  const list = goaliesByTeam.get(p.team) ?? [];
  list.push(p.gamesPlayed);
  goaliesByTeam.set(p.team, list);
}
const overloadedTeams = findOverloadedGoalieTeams(goaliesByTeam);
const underloadedTeams = findUnderloadedGoalieTeams(goaliesByTeam);
if (overloadedTeams.length > 0) {
  errors.push(
    `top-3 goalie GP sum >100 on ${overloadedTeams.length} team(s): ${overloadedTeams
      .slice(0, 5)
      .join(", ")}`,
  );
}
if (underloadedTeams.length > 0) {
  errors.push(
    `top-3 goalie GP sum <60 on ${underloadedTeams.length} team(s): ${underloadedTeams
      .slice(0, 5)
      .join(", ")}`,
  );
}

const goalieSavePcts = players
  .filter((p) => p.isGoalie)
  .map((p) => (p.projection as { savePct?: number }).savePct ?? 0);
const uniqueSv = new Set(goalieSavePcts.map((v) => Math.round(v * 1000)));
if (goalieSavePcts.length >= 20 && uniqueSv.size < 5) {
  errors.push(
    `goalie SV% collapsed (${uniqueSv.size} distinct thousandths) — check projection path`,
  );
}

const topGoalie = [...players]
  .filter((p) => p.isGoalie)
  .sort((a, b) => b.vor - a.vor)[0];
if (topGoalie && topGoalieGpTooLow(topGoalie.gamesPlayed)) {
  errors.push(
    `top goalie ${topGoalie.name} has only ${topGoalie.gamesPlayed} GP (expected ≥40) — check tandem allocation`,
  );
}

const yahooPos = players.filter((p) => p.positionSource === "yahoo").length;
if (players.length > 500 && yahooPos < players.length * 0.85) {
  errors.push(
    `Yahoo position coverage ${yahooPos}/${players.length} (${((100 * yahooPos) / players.length).toFixed(0)}%) below 85%`,
  );
} else if (players.length > 500 && yahooPos < players.length * 0.92) {
  warnings.push(
    `only ${yahooPos}/${players.length} players have Yahoo positions (${((100 * yahooPos) / players.length).toFixed(0)}%)`,
  );
}

const mlWithUnc = players.filter((p) => p.projectionMethod === "ml" && p.uncertainty)
  .length;
const mlSkaters = players.filter((p) => p.projectionMethod === "ml" && !p.isGoalie)
  .length;
if (mlSkaters > 100 && mlWithUnc < mlSkaters * 0.5) {
  warnings.push(
    `only ${mlWithUnc}/${mlSkaters} ML skaters carry uncertainty — regenerate after train-v2`,
  );
}

// Board payload contract: heavy fields belong in player-details.json.
const boardBloat = players.filter(
  (p) =>
    p.reasoning != null ||
    p.profileSummary != null ||
    p.marketEdge != null ||
    (p.uncertainty?.perStat != null &&
      Object.keys(p.uncertainty.perStat).length > 0),
).length;
if (boardBloat > 0) {
  errors.push(
    `${boardBloat} players still carry reasoning/profileSummary/marketEdge/perStat on the board — run slim-players-json or regenerate`,
  );
}

const playersBytes = readFileSync(PLAYERS_PATH).length;
if (playersBytes > 1.5e6) {
  errors.push(
    `players.json is ${(playersBytes / 1e6).toFixed(2)}MB (max 1.5MB slim board) — re-run slim/regenerate`,
  );
} else if (playersBytes > 1.1e6) {
  warnings.push(
    `players.json is ${(playersBytes / 1e6).toFixed(2)}MB (target ≤1.0MB slim board)`,
  );
}

const detailsBytes = existsSync(DETAILS_PATH)
  ? readFileSync(DETAILS_PATH).length
  : 0;
if (detailsBytes > 2.5e6) {
  errors.push(
    `player-details.json is ${(detailsBytes / 1e6).toFixed(2)}MB (max 2.5MB)`,
  );
} else if (detailsBytes > 1.8e6) {
  warnings.push(
    `player-details.json is ${(detailsBytes / 1e6).toFixed(2)}MB (target ≤1.5MB)`,
  );
}

if (!existsSync(DETAILS_PATH)) {
  errors.push("public/player-details.json is missing (run npm run generate)");
} else {
  try {
    const details = JSON.parse(readFileSync(DETAILS_PATH, "utf8")) as Record<
      string,
      {
        perStatSigma?: Record<string, unknown>;
        perStatUncertainty?: Record<string, unknown>;
      }
    >;
    const withPerStat = Object.values(details).filter(
      (d) =>
        (d.perStatSigma && Object.keys(d.perStatSigma).length > 0) ||
        (d.perStatUncertainty && Object.keys(d.perStatUncertainty).length > 0),
    ).length;
    if (mlSkaters > 100 && withPerStat < mlSkaters * 0.5) {
      warnings.push(
        `only ${withPerStat}/${mlSkaters} detail records carry per-stat σ`,
      );
    }
  } catch (e) {
    errors.push(`player-details.json is not valid JSON: ${e}`);
  }
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (errors.length > 0) {
  for (const e of errors) console.error(`FAIL: ${e}`);
  process.exit(1);
}

console.log(
  `OK: ${players.length} players (${skaters} skaters, ${goalies} goalies), generated ${data.generatedAt}`,
);
