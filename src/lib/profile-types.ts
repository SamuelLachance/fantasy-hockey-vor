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

export interface InjuryProfile {
  gamesPlayedLastSeason: number;
  gamesMissedLastSeason: number;
  avgGamesPlayedLast3: number;
  durabilityScore: number;
  trend: "healthy" | "moderate" | "injury_prone";
  note: string;
}

export interface ContractEstimate {
  yearsSinceDraft: number;
  careerStage: "rookie" | "entry_level" | "prime" | "veteran" | "decline";
  contractYearNote: string;
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
  injury: InjuryProfile;
  contract: ContractEstimate;
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

export type ProjectionMethod = "ai" | "contextual";
