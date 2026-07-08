import { PROJECTION_SEASON_ID } from "../nhl-api";
import type { PlayerProfile } from "../profile-types";
import { lookupDraftByName } from "../draft-registry";
import { ageAtSeasonStart, loadDraftRegistrySync } from "./player-context";
import type { MlContextCaches } from "./context-types";
import { contractSeasonKey, teamSeasonKey } from "./context-types";
import { enrichPlayerSeasonRow } from "./enrich-rows";
import type { PlayerSeasonRow } from "./types";
import { SKATER_AUX_LAG_STATS } from "./types";
import { seasonIdToLabel } from "../nhl-api";
import {
  loadMoneyPuckSkaterRegistrySync,
  lookupMoneyPuckSkaterSeason,
  moneyPuckToSkaterFields,
} from "../moneypuck-skaters";

function adv(s: PlayerProfile["teamHistory"][number], key: string): number {
  return s.advanced[key] ?? s.stats[key] ?? 0;
}

function profileSeasonToRow(
  profile: PlayerProfile,
  s: PlayerProfile["teamHistory"][number],
  mpRegistry: ReturnType<typeof loadMoneyPuckSkaterRegistrySync>,
): PlayerSeasonRow {
  const goals = s.stats.goals ?? 0;
  const assists = s.stats.assists ?? 0;
  const aux: Partial<PlayerSeasonRow> = {};
  for (const stat of SKATER_AUX_LAG_STATS) {
    if (stat === "points") {
      aux.points = s.stats.points ?? goals + assists;
    } else if (stat === "evGoals" || stat === "evPoints" || stat === "shootingPct") {
      aux[stat] = s.stats[stat] ?? 0;
    } else if (stat === "toiPerGame") {
      aux.toiPerGame = s.stats.toiPerGame ?? 0;
    } else if (stat === "plusMinus") {
      aux.plusMinus = s.stats.plusMinus ?? 0;
    } else {
      aux[stat as keyof PlayerSeasonRow] = adv(s, stat) as never;
    }
  }

  const mp =
    !s.isGoalie && mpRegistry
      ? lookupMoneyPuckSkaterSeason(mpRegistry, profile.id, s.seasonId, profile.name)
      : null;

  return {
    playerId: profile.id,
    name: profile.name,
    seasonId: s.seasonId,
    team: s.team,
    position: profile.position,
    isGoalie: s.isGoalie,
    gamesPlayed: s.gamesPlayed,
    goals,
    assists,
    shots: s.stats.shots ?? 0,
    blocks: s.advanced.blocks ?? 0,
    hits: s.advanced.hits ?? 0,
    powerplayPoints: s.stats.ppPoints ?? 0,
    penaltyMinutes: s.stats.pim ?? 0,
    faceoffWins: s.advanced.faceoffWins ?? 0,
    ...aux,
    ...(mp ? moneyPuckToSkaterFields(mp) : {}),
    wins: s.stats.wins ?? 0,
    shutouts: s.stats.shutouts ?? 0,
    saves: s.stats.saves ?? 0,
    savePct: s.stats.savePct ?? 0.905,
    teamGoalsForPerGame: profile.teamContext.goalsForPerGame,
    teamGoalsAgainstPerGame: profile.teamContext.goalsAgainstPerGame,
    teamGoalDiffPerGame:
      profile.teamContext.goalsForPerGame - profile.teamContext.goalsAgainstPerGame,
  };
}

export function profileToSeasonRows(
  profile: PlayerProfile,
  caches: MlContextCaches | null,
): PlayerSeasonRow[] {
  const mpRegistry = loadMoneyPuckSkaterRegistrySync();
  const rows: PlayerSeasonRow[] = profile.teamHistory.map((s) =>
    profileSeasonToRow(profile, s, mpRegistry),
  );

  if (caches) {
    return rows.map((r) => enrichPlayerSeasonRow(r, caches));
  }

  return rows;
}

export function buildProjectionTargetRow(
  profile: PlayerProfile,
  caches: MlContextCaches | null,
): PlayerSeasonRow {
  const seasonId = PROJECTION_SEASON_ID;
  const seasonLabel = seasonIdToLabel(seasonId);
  const primaryTeam = profile.team.split(",")[0].trim().toUpperCase();
  const teamCtx = caches?.teamBySeasonTeam[teamSeasonKey(seasonId, primaryTeam)];
  const contract = caches?.contractByPlayerSeason[
    contractSeasonKey(profile.id, seasonLabel)
  ];

  const birthDate = profile.bio.birthDate;
  const registry = loadDraftRegistrySync();
  const draftFromRegistry =
    !profile.draft?.overallPick && registry
      ? lookupDraftByName(registry, profile.name)
      : null;
  const draftOverall =
    profile.draft?.overallPick ??
    (draftFromRegistry ? draftFromRegistry.overallPick : 0);
  const draftRound =
    profile.draft?.round ?? (draftFromRegistry ? draftFromRegistry.round : 0);
  const draftYear =
    profile.draft?.year ?? (draftFromRegistry ? draftFromRegistry.year : 0);

  const row: PlayerSeasonRow = {
    playerId: profile.id,
    name: profile.name,
    seasonId,
    team: profile.team,
    position: profile.position,
    isGoalie: profile.isGoalie,
    gamesPlayed: 0,
    goals: 0,
    assists: 0,
    shots: 0,
    blocks: 0,
    hits: 0,
    powerplayPoints: 0,
    penaltyMinutes: 0,
    faceoffWins: 0,
    wins: 0,
    shutouts: 0,
    saves: 0,
    savePct: 0.905,
    teamGoalsForPerGame: teamCtx?.goalsForPerGame ?? profile.teamContext.goalsForPerGame,
    teamGoalsAgainstPerGame:
      teamCtx?.goalsAgainstPerGame ?? profile.teamContext.goalsAgainstPerGame,
    teamGoalDiffPerGame:
      teamCtx?.goalDiffPerGame ??
      profile.teamContext.goalsForPerGame - profile.teamContext.goalsAgainstPerGame,
    age: ageAtSeasonStart(birthDate, seasonId),
    heightInches: profile.bio.heightInches,
    weightPounds: profile.bio.weightPounds,
    shootsLeft: profile.bio.shootsCatches === "L" ? 1 : 0,
    draftYear,
    draftRound,
    draftOverallPick: draftOverall,
    capHitUsd:
      contract?.capHitUsd ?? profile.contract.capHitUsd ?? 0,
    contractYearsRemaining:
      contract?.yearsRemaining ?? profile.contract.yearsRemaining ?? 0,
    teamPointPctg: teamCtx?.pointPctg ?? profile.teamContext.pointsPct,
    teamLeagueRank: teamCtx?.leagueRank ?? profile.teamContext.leagueRank,
    teamElo: teamCtx?.teamElo ?? 500,
    coachId: teamCtx?.coachId ?? 0,
    coachTenureSeasons: teamCtx?.coachTenureSeasons ?? 0,
    teamHitsPerGame: 22,
    teamPimPerGame: 8,
    teamBlocksPerGame: 14,
    teamPpGoalShare: 0.2,
    teamPkGaPer60: 2.5,
  };

  return row;
}
