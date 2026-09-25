import { execFileSync, spawn } from "child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { createServer } from "https";
import { tmpdir } from "os";
import { writeFileAtomic } from "../src/lib/atomic-write";
import { join } from "path";
import * as readline from "readline";
import {
  exchangeYahooCode,
  fetchAllYahooNhlPlayers,
  fetchYahooNhlGameKey,
  matchYahooToNhlIds,
  yahooAuthUrl,
  type NhlMatchPlayer,
} from "../src/lib/yahoo-fantasy";
import type { Position } from "../src/lib/types";

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

function loadNhlPlayers(): NhlMatchPlayer[] {
  if (!existsSync(PROFILES_PATH)) {
    throw new Error("Run npm run collect first to build player-profiles.json");
  }
  const data = JSON.parse(readFileSync(PROFILES_PATH, "utf8")) as {
    profiles: Array<{
      id: number;
      name: string;
      team: string;
      position?: Position;
      positions?: Position[];
    }>;
  };
  return data.profiles.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.position,
    positions: p.positions,
  }));
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

// Yahoo no longer accepts the "oob" redirect, so an https://localhost redirect is
// caught here with a throwaway self-signed HTTPS listener (openssl ships with Git for Windows).
function selfSignedCert(): { key: string; cert: string } | null {
  const dir = mkdtempSync(join(tmpdir(), "yahoo-oauth-"));
  const keyPath = join(dir, "key.pem");
  const certPath = join(dir, "cert.pem");
  try {
    for (const bin of ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"]) {
      try {
        execFileSync(
          bin,
          ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost"],
          { stdio: "ignore", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
        );
        return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
      } catch {
        // try the next openssl candidate
      }
    }
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function openBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32"
      ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
      : [process.platform === "darwin" ? "open" : "xdg-open", [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
    // the URL is printed as well
  }
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function waitForRedirectCode(redirectUri: string): Promise<string> | null {
  let target: URL;
  try {
    target = new URL(redirectUri);
  } catch {
    return null;
  }
  if (target.protocol !== "https:" || !["localhost", "127.0.0.1"].includes(target.hostname)) return null;
  const tls = selfSignedCert();
  if (!tls) return null;
  return new Promise((resolve, reject) => {
    const server = createServer(tls, (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      const code = params.get("code");
      res.writeHead(code ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        code
          ? "<h1>Yahoo authorized</h1><p>You can close this tab and go back to the terminal.</p>"
          : `<h1>No code received</h1><p>${escapeHtml(params.get("error_description") ?? params.get("error") ?? "")}</p>`,
      );
      if (code) {
        server.close();
        resolve(code);
      }
    });
    server.on("error", reject);
    server.listen(Number(target.port || 443), target.hostname);
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
  const redirected = waitForRedirectCode(process.env.YAHOO_REDIRECT_URI?.trim() || "oob");
  if (redirected) {
    console.log("\nOpening Yahoo in your browser: sign in and click Agree.");
    console.log("The browser then warns about the local certificate: choose Advanced -> Continue to localhost.");
    console.log(`\nIf no browser opens, visit:\n${url}\n`);
    openBrowser(url);
    await exchangeYahooCode(await redirected);
    console.log("\nSaved tokens to .yahoo-oauth.json");
    return;
  }

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
