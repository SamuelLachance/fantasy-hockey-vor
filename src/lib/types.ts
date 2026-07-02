export type SkaterPosition = "C" | "LW" | "RW" | "D";
export type Position = SkaterPosition | "G";

export const SKATER_CATEGORIES = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
] as const;

export const GOALIE_CATEGORIES = [
  "wins",
  "shutouts",
  "saves",
  "savePct",
] as const;

export type SkaterCategory = (typeof SKATER_CATEGORIES)[number];
export type GoalieCategory = (typeof GOALIE_CATEGORIES)[number];
export type Category = SkaterCategory | GoalieCategory;

export interface SkaterProjection {
  goals: number;
  assists: number;
  shots: number;
  blocks: number;
  hits: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  faceoffWins: number;
}

export interface GoalieProjection {
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
}

export interface PlayerProjection {
  id: number;
  name: string;
  team: string;
  position: Position;
  positions: Position[];
  isGoalie: boolean;
  gamesPlayed: number;
  projection: SkaterProjection | GoalieProjection;
  categoryZScores: Partial<Record<Category, number>>;
  fantasyValue: number;
  vor: number;
  rank: number;
  positionRank: number;
  projectionMethod?: "ai" | "contextual";
  confidence?: number;
  reasoning?: string;
  profileSummary?: string;
}

export interface LeagueSettings {
  teams: number;
  roster: {
    C: number;
    LW: number;
    RW: number;
    D: number;
    G: number;
  };
  season: string;
}

export interface ProjectionsDataset {
  generatedAt: string;
  season: string;
  league: LeagueSettings;
  replacementLevels: Partial<Record<Position, number>>;
  projectionEngine: string;
  aiModel?: string;
  players: PlayerProjection[];
}
