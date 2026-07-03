import { existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  moneypuckYearToSeasonId,
} from "./moneypuck-goalies";
import type { PlayerSeasonRow } from "./ml/types";

export { moneypuckYearToSeasonId, seasonIdToMoneypuckYear } from "./moneypuck-goalies";

export interface MoneyPuckSkaterSeason {
  playerId: number;
  seasonId: number;
  name: string;
  team: string;
  gamesPlayed: number;
  icetimeSeconds: number;
  xGoals: number;
  xGoalsPer60: number;
  goals: number;
  /** goals − xGoals (positive = outscoring expected). */
  goalsAboveExpected: number;
  flurryAdjustedxGoals: number;
  highDangerGoals: number;
  highDangerShots: number;
  highDangerxGoals: number;
  onIceXGoalsPct: number;
  offIceXGoalsPct: number;
  onIceCorsiPct: number;
  offIceCorsiPct: number;
  onIceFenwickPct: number;
  offIceFenwickPct: number;
  gameScore: number;
}

export interface MoneyPuckSkaterRegistry {
  builtAt: string;
  seasons: number[];
  byKey: Record<string, MoneyPuckSkaterSeason>;
  /** Fallback when NHL playerId is missing — normalized name + season. */
  byNameSeason: Record<string, MoneyPuckSkaterSeason>;
}

const REGISTRY_PATH = join(process.cwd(), "src", "data", "moneypuck-skaters.json");

let cachedRegistry: MoneyPuckSkaterRegistry | null | undefined;

export function skaterSeasonKey(playerId: number, seasonId: number): string {
  return `${playerId}|${seasonId}`;
}

export function normalizeSkaterName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function skaterNameSeasonKey(name: string, seasonId: number): string {
  return `${normalizeSkaterName(name)}|${seasonId}`;
}

function col(cols: string[], header: string[], name: string): number {
  const i = header.indexOf(name);
  return i >= 0 ? Number(cols[i]) || 0 : 0;
}

/** Parse MoneyPuck skaters.csv (situation=all rows only). */
export function parseMoneyPuckSkaterCsv(csv: string): MoneyPuckSkaterSeason[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const iPlayer = header.indexOf("playerId");
  const iSeason = header.indexOf("season");
  const iName = header.indexOf("name");
  const iTeam = header.indexOf("team");
  const iSituation = header.indexOf("situation");
  const iGp = header.indexOf("games_played");
  const iToi = header.indexOf("icetime");

  if (iPlayer < 0 || iSeason < 0 || iSituation < 0) return [];

  const rows: MoneyPuckSkaterSeason[] = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const cols = lines[lineIdx].split(",");
    if (cols.length < header.length) continue;
    if (cols[iSituation] !== "all") continue;

    const icetimeSeconds = col(cols, header, "icetime");
    const xGoals = col(cols, header, "I_F_xGoals");
    const goals = col(cols, header, "I_F_goals");
    const mpYear = Number(cols[iSeason]);
    if (!Number.isFinite(mpYear)) continue;

    rows.push({
      playerId: Number(cols[iPlayer]),
      seasonId: moneypuckYearToSeasonId(mpYear),
      name: cols[iName],
      team: cols[iTeam],
      gamesPlayed: col(cols, header, "games_played") || Number(cols[iGp]) || 0,
      icetimeSeconds,
      xGoals,
      xGoalsPer60: icetimeSeconds > 0 ? (xGoals * 3600) / icetimeSeconds : 0,
      goals,
      goalsAboveExpected: goals - xGoals,
      flurryAdjustedxGoals: col(cols, header, "I_F_flurryAdjustedxGoals"),
      highDangerGoals: col(cols, header, "I_F_highDangerGoals"),
      highDangerShots: col(cols, header, "I_F_highDangerShots"),
      highDangerxGoals: col(cols, header, "I_F_highDangerxGoals"),
      onIceXGoalsPct: col(cols, header, "onIce_xGoalsPercentage"),
      offIceXGoalsPct: col(cols, header, "offIce_xGoalsPercentage"),
      onIceCorsiPct: col(cols, header, "onIce_corsiPercentage"),
      offIceCorsiPct: col(cols, header, "offIce_corsiPercentage"),
      onIceFenwickPct: col(cols, header, "onIce_fenwickPercentage"),
      offIceFenwickPct: col(cols, header, "offIce_fenwickPercentage"),
      gameScore: col(cols, header, "gameScore"),
    });
  }

  return rows;
}

export function buildSkaterRegistryFromRows(
  rows: MoneyPuckSkaterSeason[],
  seasons: number[],
): MoneyPuckSkaterRegistry {
  const byKey: Record<string, MoneyPuckSkaterSeason> = {};
  const byNameSeason: Record<string, MoneyPuckSkaterSeason> = {};
  for (const row of rows) {
    byKey[skaterSeasonKey(row.playerId, row.seasonId)] = row;
    byNameSeason[skaterNameSeasonKey(row.name, row.seasonId)] = row;
  }
  return {
    builtAt: new Date().toISOString(),
    seasons,
    byKey,
    byNameSeason,
  };
}

export async function fetchMoneyPuckSkaterSeason(
  moneypuckYear: number,
): Promise<MoneyPuckSkaterSeason[]> {
  const url = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${moneypuckYear}/regular/skaters.csv`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MoneyPuck skaters ${moneypuckYear}: HTTP ${res.status}`);
  }
  const csv = await res.text();
  return parseMoneyPuckSkaterCsv(csv);
}

export async function buildMoneyPuckSkaterRegistry(
  moneypuckYears: number[],
  onProgress?: (msg: string) => void,
): Promise<MoneyPuckSkaterRegistry> {
  const allRows: MoneyPuckSkaterSeason[] = [];

  for (const year of moneypuckYears) {
    onProgress?.(`Fetching MoneyPuck skaters ${year}-${String(year + 1).slice(-2)}...`);
    try {
      const rows = await fetchMoneyPuckSkaterSeason(year);
      allRows.push(...rows);
      onProgress?.(`  ${rows.length} skaters (all situations)`);
    } catch (e) {
      onProgress?.(`  skipped ${year}: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return buildSkaterRegistryFromRows(allRows, moneypuckYears);
}

export function loadMoneyPuckSkaterRegistrySync(): MoneyPuckSkaterRegistry | null {
  if (cachedRegistry !== undefined) return cachedRegistry;
  if (!existsSync(REGISTRY_PATH)) {
    cachedRegistry = null;
    return null;
  }
  try {
    cachedRegistry = JSON.parse(
      readFileSync(REGISTRY_PATH, "utf8"),
    ) as MoneyPuckSkaterRegistry;
    return cachedRegistry;
  } catch {
    cachedRegistry = null;
    return null;
  }
}

export function lookupMoneyPuckSkaterSeason(
  registry: MoneyPuckSkaterRegistry | null,
  playerId: number,
  seasonId: number,
  name?: string,
): MoneyPuckSkaterSeason | null {
  if (!registry) return null;
  const byId = registry.byKey[skaterSeasonKey(playerId, seasonId)];
  if (byId) return byId;
  if (name && registry.byNameSeason) {
    return registry.byNameSeason[skaterNameSeasonKey(name, seasonId)] ?? null;
  }
  return null;
}

export function moneyPuckToSkaterFields(
  mp: MoneyPuckSkaterSeason,
): Pick<
  PlayerSeasonRow,
  | "xGoals"
  | "xGoalsPer60"
  | "goalsAboveExpected"
  | "flurryAdjustedxGoals"
  | "highDangerGoals"
  | "highDangerShots"
  | "highDangerxGoals"
  | "onIceXGoalsPct"
  | "offIceXGoalsPct"
  | "onIceCorsiPct"
  | "offIceCorsiPct"
  | "onIceFenwickPct"
  | "offIceFenwickPct"
  | "gameScore"
> {
  return {
    xGoals: mp.xGoals,
    xGoalsPer60: mp.xGoalsPer60,
    goalsAboveExpected: mp.goalsAboveExpected,
    flurryAdjustedxGoals: mp.flurryAdjustedxGoals,
    highDangerGoals: mp.highDangerGoals,
    highDangerShots: mp.highDangerShots,
    highDangerxGoals: mp.highDangerxGoals,
    onIceXGoalsPct: mp.onIceXGoalsPct,
    offIceXGoalsPct: mp.offIceXGoalsPct,
    onIceCorsiPct: mp.onIceCorsiPct,
    offIceCorsiPct: mp.offIceCorsiPct,
    onIceFenwickPct: mp.onIceFenwickPct,
    offIceFenwickPct: mp.offIceFenwickPct,
    gameScore: mp.gameScore,
  };
}

export function applyMoneyPuckSkaterFields(
  row: PlayerSeasonRow,
  registry: MoneyPuckSkaterRegistry | null = loadMoneyPuckSkaterRegistrySync(),
): PlayerSeasonRow {
  if (row.isGoalie || !registry) return row;
  const mp = lookupMoneyPuckSkaterSeason(registry, row.playerId, row.seasonId, row.name);
  if (!mp) return row;
  return { ...row, ...moneyPuckToSkaterFields(mp) };
}
