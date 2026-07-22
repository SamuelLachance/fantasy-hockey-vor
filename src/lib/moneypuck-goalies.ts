/**
 * MoneyPuck goalie season registry — expanded skill / shot-quality fields.
 *
 * Parses situation=all (primary) and situation=5on5 (even-strength skill).
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** MoneyPuck season year (e.g. 2025 = 2025–26). */
export function moneypuckYearToSeasonId(year: number): number {
  return year * 10000 + (year + 1);
}

export function seasonIdToMoneypuckYear(seasonId: number): number {
  return Math.floor(seasonId / 10000);
}

/** Even-strength (5v5) subset stored alongside all-situations totals. */
export interface MoneyPuckGoalieFiveOn5 {
  icetimeSeconds: number;
  xGoalsAgainst: number;
  goalsAgainst: number;
  shotsOnGoalAgainst: number;
  highDangerShots: number;
  highDangerGoals: number;
  highDangerxGoals: number;
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
  blockedShotAttempts: number;
  flurryAdjustedxGoals: number;
  lowDangerShots: number;
  mediumDangerShots: number;
  highDangerShots: number;
  lowDangerxGoals: number;
  mediumDangerxGoals: number;
  highDangerxGoals: number;
  lowDangerGoals: number;
  mediumDangerGoals: number;
  highDangerGoals: number;
  xRebounds: number;
  rebounds: number;
  xFreeze: number;
  freeze: number;
  /** 5v5 row when present in the CSV. */
  fiveOn5?: MoneyPuckGoalieFiveOn5;
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

function num(cols: string[], i: number): number {
  if (i < 0) return 0;
  const v = Number(cols[i]);
  return Number.isFinite(v) ? v : 0;
}

/** Parse MoneyPuck goalies.csv — keep `all` rows, attach `5on5` splits. */
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
  const iBlocked = idx("blocked_shot_attempts");
  const iFlurry = idx("flurryAdjustedxGoals");
  const iLdSh = idx("lowDangerShots");
  const iMdSh = idx("mediumDangerShots");
  const iHdSh = idx("highDangerShots");
  const iLdXg = idx("lowDangerxGoals");
  const iMdXg = idx("mediumDangerxGoals");
  const iHdXg = idx("highDangerxGoals");
  const iLdG = idx("lowDangerGoals");
  const iMdG = idx("mediumDangerGoals");
  const iHdG = idx("highDangerGoals");
  const iXReb = idx("xRebounds");
  const iReb = idx("rebounds");
  const iXFrz = idx("xFreeze");
  const iFrz = idx("freeze");

  if (iPlayer < 0 || iSeason < 0 || iSituation < 0) return [];

  const allByKey = new Map<string, MoneyPuckGoalieSeason>();
  const fiveByKey = new Map<string, MoneyPuckGoalieFiveOn5>();

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const cols = lines[lineIdx].split(",");
    if (cols.length < header.length) continue;
    const situation = cols[iSituation];
    const mpYear = Number(cols[iSeason]);
    const playerId = Number(cols[iPlayer]);
    if (!Number.isFinite(mpYear) || !Number.isFinite(playerId)) continue;
    const seasonId = moneypuckYearToSeasonId(mpYear);
    const key = goalieSeasonKey(playerId, seasonId);

    if (situation === "5on5") {
      fiveByKey.set(key, {
        icetimeSeconds: num(cols, iToi),
        xGoalsAgainst: num(cols, iXg),
        goalsAgainst: num(cols, iGoals),
        shotsOnGoalAgainst: num(cols, iOnGoal),
        highDangerShots: num(cols, iHdSh),
        highDangerGoals: num(cols, iHdG),
        highDangerxGoals: num(cols, iHdXg),
      });
      continue;
    }
    if (situation !== "all") continue;

    const xGoalsAgainst = num(cols, iXg);
    const goalsAgainst = num(cols, iGoals);
    allByKey.set(key, {
      playerId,
      seasonId,
      name: cols[iName],
      team: cols[iTeam],
      gamesPlayed: num(cols, iGp),
      icetimeSeconds: num(cols, iToi),
      xGoalsAgainst,
      goalsAgainst,
      gsax: xGoalsAgainst - goalsAgainst,
      shotsOnGoalAgainst: num(cols, iOnGoal),
      unblockedShotAttempts: num(cols, iUnblocked),
      blockedShotAttempts: num(cols, iBlocked),
      flurryAdjustedxGoals: num(cols, iFlurry),
      lowDangerShots: num(cols, iLdSh),
      mediumDangerShots: num(cols, iMdSh),
      highDangerShots: num(cols, iHdSh),
      lowDangerxGoals: num(cols, iLdXg),
      mediumDangerxGoals: num(cols, iMdXg),
      highDangerxGoals: num(cols, iHdXg),
      lowDangerGoals: num(cols, iLdG),
      mediumDangerGoals: num(cols, iMdG),
      highDangerGoals: num(cols, iHdG),
      xRebounds: num(cols, iXReb),
      rebounds: num(cols, iReb),
      xFreeze: num(cols, iXFrz),
      freeze: num(cols, iFrz),
    });
  }

  const rows: MoneyPuckGoalieSeason[] = [];
  for (const [key, row] of allByKey) {
    const five = fiveByKey.get(key);
    if (five) row.fiveOn5 = five;
    rows.push(row);
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
      const withFive = rows.filter((r) => r.fiveOn5).length;
      onProgress?.(
        `  ${rows.length} goalies (all), ${withFive} with 5v5, HD/rebound/freeze fields`,
      );
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

/** High-danger SV% residual vs expected (positive = better). */
export function hdSvResidual(mp: MoneyPuckGoalieSeason): number {
  if (mp.highDangerShots < 40 || mp.highDangerxGoals <= 0) return NaN;
  const act = 1 - mp.highDangerGoals / mp.highDangerShots;
  const exp = 1 - mp.highDangerxGoals / mp.highDangerShots;
  return act - exp;
}

/** Rebound rate vs expected (negative = better control). */
export function reboundRateDelta(mp: MoneyPuckGoalieSeason): number {
  if (mp.shotsOnGoalAgainst < 200 || mp.xRebounds <= 0) return NaN;
  const act = mp.rebounds / mp.shotsOnGoalAgainst;
  const exp = mp.xRebounds / mp.shotsOnGoalAgainst;
  return act - exp;
}

/** Freeze rate vs expected (positive = more freezes than model). */
export function freezeRateDelta(mp: MoneyPuckGoalieSeason): number {
  if (mp.shotsOnGoalAgainst < 200 || mp.xFreeze <= 0) return NaN;
  const act = mp.freeze / mp.shotsOnGoalAgainst;
  const exp = mp.xFreeze / mp.shotsOnGoalAgainst;
  return act - exp;
}
