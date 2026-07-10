import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { writeFileAtomic } from "../atomic-write";
import { HISTORICAL_SEASON_IDS, seasonIdToLabel } from "../nhl-api";
import type { MlContextCaches } from "./context-types";
import {
  ageAtSeasonStart,
  buildContractSeasonMap,
  buildPlayerBioContexts,
  loadDraftRegistrySync,
} from "./player-context";
import { lookupDraftByName } from "../draft-registry";
import type { PlayerSeasonRow } from "./types";
import { buildTeamSeasonContexts } from "./team-season-context";
import { buildTeamStyleBySeasonTeam, type TeamStyleContext } from "./team-style";
import { contractSeasonKey, teamSeasonKey } from "./context-types";
import {
  applyMoneyPuckSkaterFields,
  loadMoneyPuckSkaterRegistrySync,
  type MoneyPuckSkaterRegistry,
} from "../moneypuck-skaters";

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
  writeFileAtomic(CACHE_PATH, JSON.stringify(caches));
}

export async function buildContextCaches(
  rows: PlayerSeasonRow[],
  onProgress?: (msg: string) => void,
): Promise<MlContextCaches> {
  const uniquePlayers = [...new Map(rows.map((r) => [r.playerId, r])).values()];
  const existing = loadContextCaches();

  onProgress?.("Fetching team standings, ELO, and coaches per season...");
  const teamContexts = await buildTeamSeasonContexts(HISTORICAL_SEASON_IDS, onProgress);

  // Incremental: keep cached bios (immutable data) and fetch only missing players.
  const playerBio: MlContextCaches["playerBio"] = { ...existing?.playerBio };
  const missingBio = uniquePlayers.filter((p) => !playerBio[p.playerId]);
  onProgress?.(
    `Fetching player bio for ${missingBio.length} players (${uniquePlayers.length - missingBio.length} cached)...`,
  );
  const bioMap = await buildPlayerBioContexts(
    missingBio.map((p) => ({ playerId: p.playerId, name: p.name })),
    (d, t) => {
      if (d % 100 === 0) onProgress?.(`  player bio ${d}/${t}`);
    },
  );
  for (const [id, bio] of bioMap) {
    playerBio[id] = bio;
  }

  // Contracts are a weak feature and CapWages scraping is slow — reuse the
  // existing cache wholesale; fetch only when empty AND explicitly requested.
  let contractByPlayerSeason: MlContextCaches["contractByPlayerSeason"] =
    existing?.contractByPlayerSeason ?? {};
  if (
    Object.keys(contractByPlayerSeason).length === 0 &&
    process.env.FETCH_CONTRACTS === "1"
  ) {
    onProgress?.(
      `Fetching CapWages contract history for ${uniquePlayers.length} players...`,
    );
    const contractMap = await buildContractSeasonMap(
      uniquePlayers.map((p) => ({ playerId: p.playerId, name: p.name })),
      (d, t) => {
        if (d % 50 === 0) onProgress?.(`  contracts ${d}/${t}`);
      },
    );
    contractByPlayerSeason = {};
    for (const [key, val] of contractMap) {
      contractByPlayerSeason[key] = val;
    }
  }

  const teamBySeasonTeam: Record<string, MlContextCaches["teamBySeasonTeam"][string]> =
    {};
  for (const t of teamContexts) {
    teamBySeasonTeam[teamSeasonKey(t.seasonId, t.team)] = t;
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
      const uniqueIds = new Set(rows.map((r) => r.playerId));
      let missingBios = 0;
      for (const id of uniqueIds) {
        if (!cached.playerBio[id]) missingBios++;
      }
      if (
        age < MAX_CACHE_AGE_MS &&
        Object.keys(cached.playerBio).length > 100 &&
        missingBios === 0
      ) {
        return cached;
      }
      if (missingBios > 0) {
        console.log(
          `Context cache missing ${missingBios} player bios — refreshing incrementally...`,
        );
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
  teamStyle?: Map<string, TeamStyleContext>,
  mpRegistry: MoneyPuckSkaterRegistry | null = loadMoneyPuckSkaterRegistrySync(),
): PlayerSeasonRow {
  const primaryTeam = row.team.split(",")[0].trim().toUpperCase();
  const teamCtx = caches.teamBySeasonTeam[teamSeasonKey(row.seasonId, primaryTeam)];
  const style = teamStyle?.get(teamSeasonKey(row.seasonId, primaryTeam));
  const bio = caches.playerBio[row.playerId];
  const registry = loadDraftRegistrySync();
  const draftFromRegistry =
    !bio?.draftOverallPick && registry
      ? lookupDraftByName(registry, row.name)
      : null;
  const draftOverall =
    bio?.draftOverallPick ??
    (draftFromRegistry ? draftFromRegistry.overallPick : 0);
  const draftRound =
    bio?.draftRound ??
    (draftFromRegistry ? draftFromRegistry.round : 0);

  const seasonLabel = seasonIdToLabel(row.seasonId);
  const contract =
    caches.contractByPlayerSeason[contractSeasonKey(row.playerId, seasonLabel)];

  const withMoneyPuck = applyMoneyPuckSkaterFields(row, mpRegistry);

  return {
    ...withMoneyPuck,
    age: bio ? ageAtSeasonStart(bio.birthDate, row.seasonId) : 0,
    heightInches: bio?.heightInches ?? 72,
    weightPounds: bio?.weightPounds ?? 190,
    shootsLeft: bio?.shootsLeft ?? 0,
    draftYear: bio?.draftYear ?? draftFromRegistry?.year ?? 0,
    draftRound,
    draftOverallPick: draftOverall,
    capHitUsd: contract?.capHitUsd ?? 0,
    contractYearsRemaining: contract?.yearsRemaining ?? 0,
    teamGoalsForPerGame: teamCtx?.goalsForPerGame ?? row.teamGoalsForPerGame ?? 2.85,
    teamGoalsAgainstPerGame: teamCtx?.goalsAgainstPerGame ?? 2.85,
    teamGoalDiffPerGame: teamCtx?.goalDiffPerGame ?? 0,
    teamPointPctg: teamCtx?.pointPctg ?? 0.5,
    teamLeagueRank: teamCtx?.leagueRank ?? 16,
    teamElo: teamCtx?.teamElo ?? 500,
    coachId: teamCtx?.coachId ?? 0,
    coachTenureSeasons: teamCtx?.coachTenureSeasons ?? 0,
    teamHitsPerGame: style?.hitsPerGame ?? 22,
    teamPimPerGame: style?.pimPerGame ?? 8,
    teamBlocksPerGame: style?.blocksPerGame ?? 14,
    teamPpGoalShare: style?.ppGoalShare ?? 0.2,
    teamPkGaPer60: style?.pkGoalsAgainstPer60 ?? 2.5,
  };
}

export function enrichAllRows(
  rows: PlayerSeasonRow[],
  caches: MlContextCaches,
  teamStyle?: Map<string, TeamStyleContext>,
): PlayerSeasonRow[] {
  const mpRegistry = loadMoneyPuckSkaterRegistrySync();
  const style = teamStyle ?? buildTeamStyleBySeasonTeam(rows);
  return rows.map((row) => enrichPlayerSeasonRow(row, caches, style, mpRegistry));
}
