import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { HISTORICAL_SEASON_IDS, seasonIdToLabel } from "../nhl-api";
import type { MlContextCaches } from "./context-types";
import {
  ageAtSeasonStart,
  buildContractSeasonMap,
  buildPlayerBioContexts,
  draftOverallLog,
  yearsSinceDraft,
} from "./player-context";
import type { PlayerSeasonRow } from "./types";
import { buildTeamSeasonContexts } from "./team-season-context";
import { contractSeasonKey, teamSeasonKey } from "./context-types";

const CACHE_PATH = join(process.cwd(), "src", "data", "ml", "context-cache.json");
const MAX_CACHE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function loadContextCaches(): MlContextCaches | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as MlContextCaches;
  } catch {
    return null;
  }
}

export function saveContextCaches(caches: MlContextCaches): void {
  mkdirSync(join(process.cwd(), "src", "data", "ml"), { recursive: true });
  writeFileSync(CACHE_PATH, JSON.stringify(caches));
}

export async function buildContextCaches(
  rows: PlayerSeasonRow[],
  onProgress?: (msg: string) => void,
): Promise<MlContextCaches> {
  const playerIds = [...new Set(rows.map((r) => r.playerId))];
  const uniquePlayers = [...new Map(rows.map((r) => [r.playerId, r])).values()];

  onProgress?.("Fetching team standings, ELO, and coaches per season...");
  const teamContexts = await buildTeamSeasonContexts(HISTORICAL_SEASON_IDS, onProgress);

  onProgress?.(`Fetching player bio for ${playerIds.length} players...`);
  const bioMap = await buildPlayerBioContexts(playerIds, (d, t) => {
    if (d % 100 === 0) onProgress?.(`  player bio ${d}/${t}`);
  });

  onProgress?.(`Fetching CapWages contract history for ${uniquePlayers.length} players...`);
  const contractMap = await buildContractSeasonMap(
    uniquePlayers.map((p) => ({ playerId: p.playerId, name: p.name })),
    (d, t) => {
      if (d % 50 === 0) onProgress?.(`  contracts ${d}/${t}`);
    },
  );

  const teamBySeasonTeam: Record<string, MlContextCaches["teamBySeasonTeam"][string]> =
    {};
  for (const t of teamContexts) {
    teamBySeasonTeam[teamSeasonKey(t.seasonId, t.team)] = t;
  }

  const playerBio: MlContextCaches["playerBio"] = {};
  for (const [id, bio] of bioMap) {
    playerBio[id] = bio;
  }

  const contractByPlayerSeason: MlContextCaches["contractByPlayerSeason"] = {};
  for (const [key, val] of contractMap) {
    contractByPlayerSeason[key] = val;
  }

  return {
    builtAt: new Date().toISOString(),
    teamBySeasonTeam,
    playerBio,
    contractByPlayerSeason,
  };
}

export async function loadOrBuildContextCaches(
  rows: PlayerSeasonRow[],
  force = false,
): Promise<MlContextCaches> {
  if (!force) {
    const cached = loadContextCaches();
    if (cached) {
      const age = Date.now() - new Date(cached.builtAt).getTime();
      if (age < MAX_CACHE_AGE_MS && Object.keys(cached.playerBio).length > 100) {
        return cached;
      }
    }
  }

  const caches = await buildContextCaches(rows, (msg) => console.log(msg));
  saveContextCaches(caches);
  return caches;
}

export function enrichPlayerSeasonRow(
  row: PlayerSeasonRow,
  caches: MlContextCaches,
): PlayerSeasonRow {
  const primaryTeam = row.team.split(",")[0].trim().toUpperCase();
  const teamCtx = caches.teamBySeasonTeam[teamSeasonKey(row.seasonId, primaryTeam)];
  const bio = caches.playerBio[row.playerId];
  const seasonLabel = seasonIdToLabel(row.seasonId);
  const contract =
    caches.contractByPlayerSeason[contractSeasonKey(row.playerId, seasonLabel)];

  return {
    ...row,
    age: bio ? ageAtSeasonStart(bio.birthDate, row.seasonId) : 0,
    heightInches: bio?.heightInches ?? 72,
    weightPounds: bio?.weightPounds ?? 190,
    shootsLeft: bio?.shootsLeft ?? 0,
    draftYear: bio?.draftYear ?? 0,
    draftRound: bio?.draftRound ?? 0,
    draftOverallPick: bio?.draftOverallPick ?? 999,
    draftOverallLog: bio ? draftOverallLog(bio.draftOverallPick) : draftOverallLog(999),
    yearsSinceDraft: bio ? yearsSinceDraft(row.seasonId, bio.draftYear) : 0,
    capHitUsd: contract?.capHitUsd ?? 0,
    contractYearsRemaining: contract?.yearsRemaining ?? 0,
    teamPointPctg: teamCtx?.pointPctg ?? 0.5,
    teamLeagueRank: teamCtx?.leagueRank ?? 16,
    teamElo: teamCtx?.teamElo ?? 500,
    coachId: teamCtx?.coachId ?? 0,
    coachTenureSeasons: teamCtx?.coachTenureSeasons ?? 0,
  };
}

export function enrichAllRows(
  rows: PlayerSeasonRow[],
  caches: MlContextCaches,
): PlayerSeasonRow[] {
  return rows.map((row) => enrichPlayerSeasonRow(row, caches));
}
