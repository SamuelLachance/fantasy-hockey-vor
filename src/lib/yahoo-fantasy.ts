import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import type { Position } from "./types";

const YAHOO_API = "https://fantasysports.yahooapis.com/fantasy/v2";
const YAHOO_AUTH = "https://api.login.yahoo.com/oauth2";
const TOKEN_PATH = join(process.cwd(), ".yahoo-oauth.json");

const ROSTER_POSITIONS = new Set<Position>(["C", "LW", "RW", "D", "G"]);

export interface YahooOAuthTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: string;
}

export interface YahooPlayerRecord {
  yahooPlayerId: number;
  name: string;
  team: string;
  displayPosition: string;
  primaryPosition: Position | null;
  positions: Position[];
}

export interface YahooPositionsDataset {
  fetchedAt: string;
  gameKey: string;
  matched: number;
  unmatched: number;
  byNhlId: Record<number, YahooPlayerRecord>;
  unmatchedPlayers: Array<{ name: string; team: string; yahooPlayerId: number }>;
}

function env(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function basicAuthHeader(): string {
  const id = env("YAHOO_CLIENT_ID");
  const secret = env("YAHOO_CLIENT_SECRET");
  if (!id || !secret) {
    throw new Error(
      "Set YAHOO_CLIENT_ID and YAHOO_CLIENT_SECRET in .env.local (Yahoo Developer app)",
    );
  }
  return `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
}

export function loadYahooTokens(): YahooOAuthTokens | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, "utf8")) as YahooOAuthTokens;
  } catch {
    return null;
  }
}

export function saveYahooTokens(tokens: YahooOAuthTokens): void {
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function yahooAuthUrl(): string {
  const clientId = env("YAHOO_CLIENT_ID");
  if (!clientId) {
    throw new Error("Set YAHOO_CLIENT_ID in .env.local");
  }
  const redirectUri = env("YAHOO_REDIRECT_URI") ?? "oob";
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    language: "en-us",
  });
  return `${YAHOO_AUTH}/request_auth?${params}`;
}

export async function exchangeYahooCode(code: string): Promise<YahooOAuthTokens> {
  const redirectUri = env("YAHOO_REDIRECT_URI") ?? "oob";
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
    code: code.trim(),
  });
  const res = await fetch(`${YAHOO_AUTH}/get_token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Yahoo token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    token_type: string;
  };
  const tokens: YahooOAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    token_type: data.token_type,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };
  saveYahooTokens(tokens);
  return tokens;
}

async function refreshYahooTokens(refreshToken: string): Promise<YahooOAuthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(`${YAHOO_AUTH}/get_token`, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    throw new Error(`Yahoo token refresh failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  };
  const tokens: YahooOAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? refreshToken,
    token_type: data.token_type,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
  };
  saveYahooTokens(tokens);
  return tokens;
}

export async function getYahooAccessToken(): Promise<string> {
  let tokens = loadYahooTokens();
  if (!tokens) {
    throw new Error(
      "No Yahoo OAuth tokens. Run: npm run yahoo:auth — then paste the verification code.",
    );
  }
  if (Date.now() >= tokens.expires_at) {
    tokens = await refreshYahooTokens(tokens.refresh_token);
  }
  return tokens.access_token;
}

async function yahooGet(path: string): Promise<unknown> {
  const token = await getYahooAccessToken();
  const url = `${YAHOO_API}${path}${path.includes("?") ? "&" : "?"}format=json`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Yahoo API ${path} failed (${res.status}): ${await res.text()}`);
  }
  return res.json();
}

function unwrapYahoo(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(unwrapYahoo);
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  if ("0" in obj && Object.keys(obj).every((k) => k === "0" || k === "count")) {
    return unwrapYahoo(obj["0"]);
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = unwrapYahoo(v);
  }
  return out;
}

function parsePositionCode(raw: string): Position | null {
  const code = raw.trim().toUpperCase();
  if (ROSTER_POSITIONS.has(code as Position)) return code as Position;
  return null;
}

export function parseYahooEligiblePositions(raw: unknown): Position[] {
  const found = new Set<Position>();

  const visit = (value: unknown) => {
    if (typeof value === "string") {
      const pos = parsePositionCode(value);
      if (pos) found.add(pos);
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (value && typeof value === "object") {
      const obj = value as Record<string, unknown>;
      if (typeof obj.position === "string") visit(obj.position);
      for (const v of Object.values(obj)) visit(v);
    }
  };

  visit(raw);

  const order: Position[] = ["C", "LW", "RW", "D", "G"];
  return order.filter((p) => found.has(p));
}

function getFantasyContent(payload: unknown): Record<string, unknown> | undefined {
  const root = unwrapYahoo(payload);
  if (!root || typeof root !== "object") return undefined;
  return (root as Record<string, unknown>).fantasy_content as
    | Record<string, unknown>
    | undefined;
}

function flattenYahooPlayerRecord(
  playerNode: Record<string, unknown>,
): Record<string, unknown> | null {
  const playerArr = playerNode?.player;
  if (!Array.isArray(playerArr) || playerArr.length === 0) return null;

  // Yahoo wraps fields in player: [[ { player_id }, { name }, ... ]]
  const fieldList = Array.isArray(playerArr[0])
    ? (playerArr[0] as unknown[])
    : playerArr;

  const flat: Record<string, unknown> = {};
  for (const chunk of fieldList) {
    if (chunk && typeof chunk === "object" && !Array.isArray(chunk)) {
      Object.assign(flat, chunk as Record<string, unknown>);
    }
  }
  return Object.keys(flat).length > 0 ? flat : null;
}

function extractPlayersFromGamePayload(payload: unknown): Record<string, unknown>[] {
  const content = getFantasyContent(payload);
  const game = content?.game as unknown;
  const gameArr = Array.isArray(game) ? game : [game];
  const players: Record<string, unknown>[] = [];

  for (const entry of gameArr) {
    if (!entry || typeof entry !== "object") continue;
    const playersNode = (entry as Record<string, unknown>).players as
      | Record<string, unknown>
      | undefined;
    if (!playersNode) continue;
    for (const [key, value] of Object.entries(playersNode)) {
      if (key === "count") continue;
      const flat = flattenYahooPlayerRecord(value as Record<string, unknown>);
      if (flat) players.push(flat);
    }
  }

  return players;
}

function parseYahooPlayer(raw: Record<string, unknown>): YahooPlayerRecord | null {
  const nameObj = raw.name as Record<string, string> | undefined;
  const name = nameObj?.full ?? nameObj?.ascii_first
    ? `${nameObj?.ascii_first ?? ""} ${nameObj?.ascii_last ?? ""}`.trim()
    : "";
  const yahooPlayerId = Number(raw.player_id);
  const team = String(raw.editorial_team_abbr ?? "").toUpperCase();
  if (!name || !Number.isFinite(yahooPlayerId)) return null;

  const positions = parseYahooEligiblePositions(raw.eligible_positions);
  const displayPosition = String(raw.display_position ?? positions.join(","));
  const fromDisplay = displayPosition
    .split(",")
    .map((p) => parsePositionCode(p))
    .filter((p): p is Position => p !== null);
  const merged = [...new Set([...positions, ...fromDisplay])];
  const order: Position[] = ["C", "LW", "RW", "D", "G"];
  const finalPositions = order.filter((p) => merged.includes(p));

  const primaryRaw = String(raw.primary_position ?? finalPositions[0] ?? "");
  const primaryPosition = parsePositionCode(primaryRaw);

  return {
    yahooPlayerId,
    name,
    team,
    displayPosition,
    primaryPosition,
    positions: finalPositions.length > 0 ? finalPositions : primaryPosition ? [primaryPosition] : [],
  };
}

export async function fetchYahooNhlGameKey(): Promise<string> {
  const payload = await yahooGet("/game/nhl");
  const content = getFantasyContent(payload);
  const game = content?.game as Record<string, unknown>[] | Record<string, unknown> | undefined;
  const first = Array.isArray(game) ? game[0] : game;
  const gameKey = String((first as Record<string, unknown> | undefined)?.game_key ?? "nhl");
  return gameKey;
}

export async function fetchAllYahooNhlPlayers(
  onProgress?: (fetched: number) => void,
): Promise<YahooPlayerRecord[]> {
  const gameKey = await fetchYahooNhlGameKey();
  const pageSize = 25;
  const all: YahooPlayerRecord[] = [];
  let start = 0;

  while (true) {
    const payload = await yahooGet(
      `/game/${gameKey}/players?start=${start}&count=${pageSize}&status=A`,
    );
    const batch = extractPlayersFromGamePayload(payload)
      .map(parseYahooPlayer)
      .filter((p): p is YahooPlayerRecord => p !== null && p.positions.length > 0);

    all.push(...batch);
    onProgress?.(all.length);

    if (batch.length < pageSize) break;
    start += pageSize;
    await new Promise((r) => setTimeout(r, 1200));
  }

  return all;
}

export function normalizePlayerName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const TEAM_ALIASES: Record<string, string> = {
  ARI: "UTA",
  PHX: "UTA",
  SJ: "SJS",
  LA: "LAK",
  NJ: "NJD",
  TB: "TBL",
};

export function normalizeTeam(team: string): string {
  const t = team.toUpperCase();
  return TEAM_ALIASES[t] ?? t;
}

export function matchYahooToNhlIds(
  yahooPlayers: YahooPlayerRecord[],
  nhlPlayers: Array<{ id: number; name: string; team: string }>,
): YahooPositionsDataset {
  const byNameTeam = new Map<string, number[]>();
  const byName = new Map<string, number[]>();

  for (const p of nhlPlayers) {
    const key = `${normalizePlayerName(p.name)}|${normalizeTeam(p.team)}`;
    const list = byNameTeam.get(key) ?? [];
    list.push(p.id);
    byNameTeam.set(key, list);

    const nameKey = normalizePlayerName(p.name);
    const nameList = byName.get(nameKey) ?? [];
    nameList.push(p.id);
    byName.set(nameKey, nameList);
  }

  const byNhlId: Record<number, YahooPlayerRecord> = {};
  const unmatchedPlayers: YahooPositionsDataset["unmatchedPlayers"] = [];

  for (const yp of yahooPlayers) {
    const key = `${normalizePlayerName(yp.name)}|${normalizeTeam(yp.team)}`;
    let ids = byNameTeam.get(key);
    if (!ids || ids.length !== 1) {
      const nameIds = byName.get(normalizePlayerName(yp.name));
      ids = nameIds?.length === 1 ? nameIds : ids;
    }
    if (ids?.length === 1) {
      byNhlId[ids[0]] = yp;
    } else {
      unmatchedPlayers.push({
        name: yp.name,
        team: yp.team,
        yahooPlayerId: yp.yahooPlayerId,
      });
    }
  }

  return {
    fetchedAt: new Date().toISOString(),
    gameKey: "nhl",
    matched: Object.keys(byNhlId).length,
    unmatched: unmatchedPlayers.length,
    byNhlId,
    unmatchedPlayers,
  };
}
