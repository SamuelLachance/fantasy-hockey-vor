import type { Position } from "../types";

export const SKATER_ML_TARGETS = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
  "faceoffWins",
] as const;

export const GOALIE_ML_TARGETS = [
  "wins",
  "shutouts",
  "saves",
  "savePct",
] as const;

export type SkaterMlTarget = (typeof SKATER_ML_TARGETS)[number];
export type GoalieMlTarget = (typeof GOALIE_ML_TARGETS)[number];

export interface PlayerSeasonRow {
  playerId: number;
  name: string;
  seasonId: number;
  team: string;
  position: Position;
  isGoalie: boolean;
  gamesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  blocks: number;
  hits: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  faceoffWins: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
  teamGoalsForPerGame: number;
}

export interface MlDataset {
  builtAt: string;
  seasonIds: number[];
  rows: PlayerSeasonRow[];
}

export interface RidgeModel {
  target: string;
  isGoalie: boolean;
  featureNames: string[];
  means: number[];
  stds: number[];
  weights: number[];
  bias: number;
  lambda: number;
}

export interface MlModelBundle {
  trainedAt: string;
  featureLags: number;
  minSeasonGp: number;
  skaterModels: RidgeModel[];
  goalieModels: RidgeModel[];
  goalieGpModel: RidgeModel;
  metrics: {
    skater: Record<string, ModelMetrics>;
    goalie: Record<string, ModelMetrics>;
    goalieGp: ModelMetrics;
  };
}

export interface ModelMetrics {
  samples: number;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
}
