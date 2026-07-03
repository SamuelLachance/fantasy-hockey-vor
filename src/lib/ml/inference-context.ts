import { PROJECTION_SEASON_ID } from "../nhl-api";
import type { PlayerProfile } from "../profile-types";
import {
  ageAtSeasonStart,
  draftOverallLog,
  yearsSinceDraft,
} from "./player-context";
import type { MlContextCaches } from "./context-types";
import { contractSeasonKey, teamSeasonKey } from "./context-types";
import { enrichPlayerSeasonRow } from "./enrich-rows";
import type { PlayerSeasonRow } from "./types";
import { seasonIdToLabel } from "../nhl-api";

export function profileToSeasonRows(
  profile: PlayerProfile,
  caches: MlContextCaches | null,
): PlayerSeasonRow[] {
  const rows: PlayerSeasonRow[] = profile.teamHistory.map((s) => ({
    playerId: profile.id,
    name: profile.name,
    seasonId: s.seasonId,
    team: s.team,
    position: profile.position,
    isGoalie: s.isGoalie,
    gamesPlayed: s.gamesPlayed,
    goals: s.stats.goals ?? 0,
    assists: s.stats.assists ?? 0,
    shots: s.stats.shots ?? 0,
    blocks: s.advanced.blocks ?? 0,
    hits: s.advanced.hits ?? 0,
    powerplayPoints: s.stats.ppPoints ?? 0,
    penaltyMinutes: s.stats.pim ?? 0,
    faceoffWins: s.advanced.faceoffWins ?? 0,
    wins: s.stats.wins ?? 0,
    shutouts: s.stats.shutouts ?? 0,
    saves: s.stats.saves ?? 0,
    savePct: s.stats.savePct ?? 0.905,
    teamGoalsForPerGame: profile.teamContext.goalsForPerGame,
  }));

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
  const draft = profile.draft;

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
    teamGoalsForPerGame: profile.teamContext.goalsForPerGame,
    age: ageAtSeasonStart(birthDate, seasonId),
    heightInches: profile.bio.heightInches,
    weightPounds: profile.bio.weightPounds,
    shootsLeft: profile.bio.shootsCatches === "L" ? 1 : 0,
    draftYear: draft?.year ?? 0,
    draftRound: draft?.round ?? 0,
    draftOverallPick: draft?.overallPick ?? 999,
    draftOverallLog: draftOverallLog(draft?.overallPick ?? 999),
    yearsSinceDraft: yearsSinceDraft(seasonId, draft?.year ?? 0),
    capHitUsd:
      contract?.capHitUsd ?? profile.contract.capHitUsd ?? 0,
    contractYearsRemaining:
      contract?.yearsRemaining ?? profile.contract.yearsRemaining ?? 0,
    teamPointPctg: teamCtx?.pointPctg ?? profile.teamContext.pointsPct,
    teamLeagueRank: teamCtx?.leagueRank ?? profile.teamContext.leagueRank,
    teamElo: teamCtx?.teamElo ?? 500,
    coachId: teamCtx?.coachId ?? 0,
    coachTenureSeasons: teamCtx?.coachTenureSeasons ?? 0,
  };

  return row;
}
