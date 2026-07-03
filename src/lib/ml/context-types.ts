/** Team-level context for one NHL season (cached during ML dataset build). */
export interface TeamSeasonContext {
  seasonId: number;
  team: string;
  pointPctg: number;
  leagueRank: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDiffPerGame: number;
  teamElo: number;
  coachId: number;
  coachTenureSeasons: number;
}

/** Static + time-varying player bio used for ML context features. */
export interface PlayerBioContext {
  playerId: number;
  birthDate: string | null;
  heightInches: number;
  weightPounds: number;
  shootsLeft: number;
  draftYear: number;
  draftRound: number;
  draftOverallPick: number;
}

/** Cap hit / term for a specific contract season label (e.g. "2024-25"). */
export interface PlayerContractSeason {
  playerId: number;
  seasonLabel: string;
  capHitUsd: number;
  yearsRemaining: number;
}

export interface MlContextCaches {
  builtAt: string;
  teamBySeasonTeam: Record<string, TeamSeasonContext>;
  playerBio: Record<number, PlayerBioContext>;
  contractByPlayerSeason: Record<string, PlayerContractSeason>;
}

export function teamSeasonKey(seasonId: number, team: string): string {
  return `${seasonId}|${team.split(",")[0].trim().toUpperCase()}`;
}

export function contractSeasonKey(playerId: number, seasonLabel: string): string {
  return `${playerId}|${seasonLabel}`;
}
