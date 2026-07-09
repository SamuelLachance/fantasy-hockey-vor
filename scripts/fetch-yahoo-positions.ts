import { existsSync, readFileSync } from "fs";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { join } from "path";
import * as readline from "readline";
import {
  exchangeYahooCode,
  fetchAllYahooNhlPlayers,
  fetchYahooNhlGameKey,
  matchYahooToNhlIds,
  yahooAuthUrl,
} from "../src/lib/yahoo-fantasy";

function loadEnvLocal(): void {
  const path = join(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvLocal();

const PROFILES_PATH = join(process.cwd(), "src", "data", "player-profiles.json");
const OUT_PATH = join(process.cwd(), "src", "data", "yahoo-positions.json");

function loadNhlPlayers(): Array<{ id: number; name: string; team: string }> {
  if (!existsSync(PROFILES_PATH)) {
    throw new Error("Run npm run collect first to build player-profiles.json");
  }
  const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
    profiles: Array<{ id: number; name: string; team: string }>;
  };
  return data.profiles.map((p) => ({ id: p.id, name: p.name, team: p.team }));
}

async function promptCode(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question("Paste the verification code: ", (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function auth() {
  const codeArg = process.argv[3];
  if (codeArg) {
    await exchangeYahooCode(codeArg);
    console.log("\nSaved tokens to .yahoo-oauth.json");
    return;
  }

  const url = yahooAuthUrl();
  console.log("\n1. Open this URL in your browser and authorize the app:\n");
  console.log(url);
  console.log("\n2. Copy the verification code Yahoo shows you.\n");
  const code = await promptCode();
  await exchangeYahooCode(code);
  console.log("\nSaved tokens to .yahoo-oauth.json");
}

async function fetchPositions() {
  const gameKey = await fetchYahooNhlGameKey();
  console.log(`Yahoo NHL game key: ${gameKey}`);
  console.log("Fetching Yahoo Fantasy NHL player eligibility...");
  const yahooPlayers = await fetchAllYahooNhlPlayers((n) => {
    if (n % 100 === 0) console.log(`  fetched ${n} players`);
  });
  console.log(`Fetched ${yahooPlayers.length} Yahoo players with roster eligibility`);

  const nhlPlayers = loadNhlPlayers();
  const dataset = matchYahooToNhlIds(yahooPlayers, nhlPlayers);
  dataset.gameKey = gameKey;

  writeFileAtomic(OUT_PATH, JSON.stringify(dataset, null, 2));

  const multi = Object.values(dataset.byNhlId).filter((p) => p.positions.length > 1);
  console.log(
    `Wrote ${OUT_PATH}: ${dataset.matched} matched, ${dataset.unmatched} unmatched, ${multi.length} multi-position`,
  );
  if (multi.length > 0) {
    console.log(
      "Sample multi-position:",
      multi
        .slice(0, 8)
        .map((p) => `${p.name} (${p.team}): ${p.positions.join("/")}`)
        .join("\n  "),
    );
  }
  if (dataset.unmatched > 0) {
    console.warn(
      `Warning: ${dataset.unmatched} Yahoo players could not be matched to NHL IDs`,
    );
  }
}

async function main() {
  const cmd = process.argv[2] ?? "fetch";
  if (cmd === "auth") {
    await auth();
    return;
  }
  if (cmd === "fetch") {
    await fetchPositions();
    return;
  }
  console.log("Usage: tsx scripts/fetch-yahoo-positions.ts [auth|fetch]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
