import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** MoneyPuck season year (e.g. 2025 = 2025–26). */
export function moneypuckYearToSeasonId(year: number): number {
  return year * 10000 + (year + 1);
}

export function seasonIdToMoneypuckYear(seasonId: number): number {
  return Math.floor(seasonId / 10000);
}

export interface MoneyPuckGoalieSeason {
  playerId: number;
  seasonId: number;
  name: string;
  team: string;
  gamesPlayed: number;
  icetimeSeconds: number;
  xGoalsAgainst: number;
  goalsAgainst: number;
  /** xGA − GA (positive = better than expected). */
  gsax: number;
  shotsOnGoalAgainst: number;
  unblockedShotAttempts: number;
}

export interface MoneyPuckGoalieRegistry {
  builtAt: string;
  seasons: number[];
  byKey: Record<string, MoneyPuckGoalieSeason>;
}

const REGISTRY_PATH = join(process.cwd(), "src", "data", "moneypuck-goalies.json");

export function goalieSeasonKey(playerId: number, seasonId: number): string {
  return `${playerId}|${seasonId}`;
}

/** Parse MoneyPuck goalies.csv (situation=all rows only). */
export function parseMoneyPuckGoalieCsv(csv: string): MoneyPuckGoalieSeason[] {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",");
  const idx = (name: string) => header.indexOf(name);
  const iPlayer = idx("playerId");
  const iSeason = idx("season");
  const iName = idx("name");
  const iTeam = idx("team");
  const iSituation = idx("situation");
  const iGp = idx("games_played");
  const iToi = idx("icetime");
  const iXg = idx("xGoals");
  const iGoals = idx("goals");
  const iOnGoal = idx("ongoal");
  const iUnblocked = idx("unblocked_shot_attempts");

  if (iPlayer < 0 || iSeason < 0 || iSituation < 0) return [];

  const rows: MoneyPuckGoalieSeason[] = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const cols = lines[lineIdx].split(",");
    if (cols.length < header.length) continue;
    if (cols[iSituation] !== "all") continue;

    const mpYear = Number(cols[iSeason]);
    const xGoalsAgainst = Number(cols[iXg]);
    const goalsAgainst = Number(cols[iGoals]);
    if (!Number.isFinite(xGoalsAgainst) || !Number.isFinite(goalsAgainst)) continue;

    rows.push({
      playerId: Number(cols[iPlayer]),
      seasonId: moneypuckYearToSeasonId(mpYear),
      name: cols[iName],
      team: cols[iTeam],
      gamesPlayed: Number(cols[iGp]) || 0,
      icetimeSeconds: Number(cols[iToi]) || 0,
      xGoalsAgainst,
      goalsAgainst,
      gsax: xGoalsAgainst - goalsAgainst,
      shotsOnGoalAgainst: Number(cols[iOnGoal]) || 0,
      unblockedShotAttempts: Number(cols[iUnblocked]) || 0,
    });
  }

  return rows;
}

export function buildRegistryFromRows(
  rows: MoneyPuckGoalieSeason[],
  seasons: number[],
): MoneyPuckGoalieRegistry {
  const byKey: Record<string, MoneyPuckGoalieSeason> = {};
  for (const row of rows) {
    byKey[goalieSeasonKey(row.playerId, row.seasonId)] = row;
  }
  return {
    builtAt: new Date().toISOString(),
    seasons,
    byKey,
  };
}

export async function fetchMoneyPuckGoalieSeason(
  moneypuckYear: number,
): Promise<MoneyPuckGoalieSeason[]> {
  const url = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${moneypuckYear}/regular/goalies.csv`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`MoneyPuck ${moneypuckYear}: HTTP ${res.status}`);
  }
  const csv = await res.text();
  return parseMoneyPuckGoalieCsv(csv);
}

export async function buildMoneyPuckGoalieRegistry(
  moneypuckYears: number[],
  onProgress?: (msg: string) => void,
): Promise<MoneyPuckGoalieRegistry> {
  const allRows: MoneyPuckGoalieSeason[] = [];

  for (const year of moneypuckYears) {
    onProgress?.(`Fetching MoneyPuck goalies ${year}-${String(year + 1).slice(-2)}...`);
    try {
      const rows = await fetchMoneyPuckGoalieSeason(year);
      allRows.push(...rows);
      onProgress?.(`  ${rows.length} goalies (all situations)`);
    } catch (e) {
      onProgress?.(`  skipped ${year}: ${e instanceof Error ? e.message : e}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return buildRegistryFromRows(allRows, moneypuckYears);
}

export function loadMoneyPuckRegistrySync(): MoneyPuckGoalieRegistry | null {
  if (!existsSync(REGISTRY_PATH)) return null;
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as MoneyPuckGoalieRegistry;
  } catch {
    return null;
  }
}

export function lookupMoneyPuckGoalieSeason(
  registry: MoneyPuckGoalieRegistry | null,
  playerId: number,
  seasonId: number,
): MoneyPuckGoalieSeason | null {
  if (!registry) return null;
  return registry.byKey[goalieSeasonKey(playerId, seasonId)] ?? null;
}

/** Prior xGA mass for EB shrinkage of GSAx toward league average (~half-season starter). */
export const EB_PRIOR_XGA = 45;

/** Prior icetime (minutes) for per-60 GSAx shrinkage (Schuckers: ~1500 SA ≈ 25–30 starter games). */
export const EB_PRIOR_ICETIME_MIN = 1500;

/** Shrink total GSAx toward 0 using expected-goals sample size. */
export function empiricalBayesGsax(
  gsax: number,
  xGoalsAgainst: number,
  priorXGoals = EB_PRIOR_XGA,
): number {
  if (xGoalsAgainst <= 0) return 0;
  return gsax * (xGoalsAgainst / (xGoalsAgainst + priorXGoals));
}

/** Shrink GSAx per 60 toward 0 using icetime sample size. */
export function empiricalBayesGsaxPer60(
  gsax: number,
  icetimeSeconds: number,
  priorMinutes = EB_PRIOR_ICETIME_MIN,
): number {
  const minutes = icetimeSeconds / 60;
  if (minutes <= 0) return 0;
  const rate = (gsax / minutes) * 60;
  return rate * (minutes / (minutes + priorMinutes));
}

export function expectedSavePctOnShots(xGoalsAgainst: number, shotsOnGoal: number): number {
  if (shotsOnGoal <= 0) return 0.905;
  return Math.max(0.85, Math.min(0.94, 1 - xGoalsAgainst / shotsOnGoal));
}
