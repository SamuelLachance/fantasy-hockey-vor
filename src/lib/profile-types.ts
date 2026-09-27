import type { Position } from "./types";

export interface DraftInfo {
  year: number;
  round: number;
  pickInRound: number;
  overallPick: number;
  team: string;
}

export interface PlayerBio {
  age: number;
  ageAtSeasonStart: number;
  birthDate: string;
  birthCity: string;
  birthCountry: string;
  heightInches: number;
  weightPounds: number;
  shootsCatches: "L" | "R";
  sweaterNumber: number | null;
}

export interface TeamContext {
  teamAbbrev: string;
  leagueRank: number;
  pointsPct: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDifferential: number;
  l10Wins: number;
  l10GoalsFor: number;
  l10GoalsAgainst: number;
  playoffClinch: boolean;
}

export interface SeasonHistory {
  season: string;
  seasonId: number;
  team: string;
  gamesPlayed: number;
  isGoalie: boolean;
  stats: Record<string, number>;
  advanced: Record<string, number>;
}

/**
 * Club games a player dressed for outside the NHL in one season (AHL, NCAA,
 * CHL, SHL, KHL…; regular season, international events left out), from the
 * NHL landing `seasonTotals`. A season with enough of them is a split
 * season: the NHL games he did not play were spent in that league, not on
 * injured reserve (src/lib/split-season.ts).
 */
export interface OtherLeagueSeason {
  seasonId: number;
  gamesPlayed: number;
  leagues: string[];
}

export interface InjuryProfile {
  gamesPlayedLastSeason: number;
  /**
   * NHL games missed last season. A split last season (games in another
   * league) counts none: the rest of the season was not an absence.
   */
  gamesMissedLastSeason: number;
  avgGamesPlayedLast3: number;
  durabilityScore: number;
  trend: "healthy" | "moderate" | "injury_prone";
  note: string;
}

export interface ContractInfo {
  capHitUsd: number | null;
  aavUsd: number | null;
  yearsRemaining: number | null;
  expiryStatus: string | null;
  contractType: string | null;
  birthDate?: string;
  source: "capwages" | "unavailable";
  summary: string;
}

/** @deprecated use ContractInfo */
export interface ContractEstimate extends ContractInfo {
  yearsSinceDraft?: number;
  careerStage?: "rookie" | "entry_level" | "prime" | "veteran" | "decline";
  contractYearNote?: string;
}

export interface PlayerProfile {
  id: number;
  name: string;
  team: string;
  position: Position;
  positions: Position[];
  isGoalie: boolean;
  isActive: boolean;
  bio: PlayerBio;
  draft: DraftInfo | null;
  teamContext: TeamContext;
  teamHistory: SeasonHistory[];
  /**
   * Club games outside the NHL in the seasons of `teamHistory` (only seasons
   * with any). Filled at collect time from the landing; older profiles are
   * backfilled from src/data/league-seasons.json by `normalizeProfile`.
   */
  otherLeagues?: OtherLeagueSeason[];
  injury: InjuryProfile;
  contract: ContractInfo;
  careerTotals: Record<string, number>;
  awards: string[];
  last5Games: Record<string, number>[];
  advancedSeasonLatest: Record<string, number>;
  contextNarrative: string;
  collectedAt: string;
}

export interface AiSkaterProjection {
  id: number;
  gamesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  blocks: number;
  hits: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  faceoffWins: number;
  confidence: number;
  reasoning: string;
}

export interface AiGoalieProjection {
  id: number;
  gamesPlayed: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
  confidence: number;
  reasoning: string;
}

export interface AiProjectionCache {
  model: string;
  season: string;
  generatedAt: string;
  skaters: Record<number, AiSkaterProjection>;
  goalies: Record<number, AiGoalieProjection>;
}

export type ProjectionMethod = "ml" | "ai" | "contextual";
