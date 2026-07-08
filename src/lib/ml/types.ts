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

export type ProductionStrategyType =
  | "ml_only"
  | "ewma_only"
  | "lag1_only"
  | "tuned_blend"
  | "contextual_only"
  | "ml_contextual_ensemble";

export interface ProductionStrategy {
  type: ProductionStrategyType;
  blendWeights?: { ml: number; ewma: number; lag1: number };
  /** ML share when type is ml_contextual_ensemble. */
  mlContextualWeight?: number;
}

export type SkaterGpStrategyType =
  | "injury_only"
  | "ml_only"
  | "blend_45_55"
  | "blend_55_45";

export type GoalieGpStrategyType = "fixed_role" | "trend_based" | "ml_only";

/** Non-target stats included as lag features in every skater model. */
export const SKATER_AUX_LAG_STATS = [
  "toiPerGame",
  "evToiPerGame",
  "ppToiPerGame",
  "shToiPerGame",
  "shiftsPerGame",
  "satFor60",
  "shotsFor60",
  "satPct",
  "usatPct",
  "satRelative",
  "usatRelative",
  "onIceShootingPct",
  "shootingPct5v5",
  "oZoneStartPct",
  "dZoneStartPct",
  "neutralZoneStartPct",
  "zoneStartPct5v5",
  "evGoals",
  "evPoints",
  "ppGoals",
  "ppGoalsFor",
  "points",
  "shootingPct",
  "plusMinus",
  "evenStrengthGoalDiff",
  "ppToiPctPerGame",
  "ppGoalsPer60",
  "ppShotsPer60",
  "ppPointsPer60",
  "shGoalsPer60",
  "hitsPer60",
  "blockedShotsPer60",
  "giveawaysPer60",
  "takeawaysPer60",
  "penaltiesDrawnPer60",
  "penaltiesTakenPer60",
  "giveaways",
  "takeaways",
  "penaltiesDrawn",
  "penaltiesTaken",
  "totalShotAttempts",
  "missedShots",
  "totalFaceoffs",
  "faceoffWinPct",
  /** MoneyPuck expected-goals & territorial metrics */
  "xGoals",
  "xGoalsPer60",
  "goalsAboveExpected",
  "flurryAdjustedxGoals",
  "highDangerGoals",
  "highDangerShots",
  "highDangerxGoals",
  "onIceXGoalsPct",
  "offIceXGoalsPct",
  "onIceCorsiPct",
  "offIceCorsiPct",
  "onIceFenwickPct",
  "offIceFenwickPct",
  "gameScore",
] as const;

export type SkaterAuxLagStat = (typeof SKATER_AUX_LAG_STATS)[number];

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
  /** Summary / advanced stats for auxiliary ML features */
  points?: number;
  plusMinus?: number;
  evGoals?: number;
  evPoints?: number;
  shootingPct?: number;
  toiPerGame?: number;
  giveaways?: number;
  takeaways?: number;
  satFor60?: number;
  shotsFor60?: number;
  oZoneStartPct?: number;
  dZoneStartPct?: number;
  penaltiesDrawn?: number;
  penaltiesTaken?: number;
  penaltiesTakenPer60?: number;
  faceoffWinPct?: number;
  evToiPerGame?: number;
  ppToiPerGame?: number;
  shToiPerGame?: number;
  shiftsPerGame?: number;
  satPct?: number;
  usatPct?: number;
  satRelative?: number;
  usatRelative?: number;
  onIceShootingPct?: number;
  shootingPct5v5?: number;
  neutralZoneStartPct?: number;
  zoneStartPct5v5?: number;
  ppGoals?: number;
  ppToiPctPerGame?: number;
  ppGoalsPer60?: number;
  ppShotsPer60?: number;
  ppPointsPer60?: number;
  shGoalsPer60?: number;
  hitsPer60?: number;
  blockedShotsPer60?: number;
  giveawaysPer60?: number;
  takeawaysPer60?: number;
  totalShotAttempts?: number;
  missedShots?: number;
  penaltiesDrawnPer60?: number;
  totalFaceoffs?: number;
  evenStrengthGoalDiff?: number;
  ppGoalsFor?: number;
  xGoals?: number;
  xGoalsPer60?: number;
  goalsAboveExpected?: number;
  flurryAdjustedxGoals?: number;
  highDangerGoals?: number;
  highDangerShots?: number;
  highDangerxGoals?: number;
  onIceXGoalsPct?: number;
  offIceXGoalsPct?: number;
  onIceCorsiPct?: number;
  offIceCorsiPct?: number;
  onIceFenwickPct?: number;
  offIceFenwickPct?: number;
  gameScore?: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
  teamGoalsForPerGame: number;
  teamGoalsAgainstPerGame?: number;
  teamGoalDiffPerGame?: number;
  teamHitsPerGame?: number;
  teamPimPerGame?: number;
  teamBlocksPerGame?: number;
  teamPpGoalShare?: number;
  teamPkGaPer60?: number;
  /** ML context — player age at season start */
  age?: number;
  heightInches?: number;
  weightPounds?: number;
  shootsLeft?: number;
  draftYear?: number;
  draftRound?: number;
  draftOverallPick?: number;
  capHitUsd?: number;
  contractYearsRemaining?: number;
  teamPointPctg?: number;
  teamLeagueRank?: number;
  teamElo?: number;
  coachId?: number;
  coachTenureSeasons?: number;
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
  /** Skater models trained on D-only or F-only rows; default all. */
  positionGroup?: "all" | "D" | "F";
  /** Weight on EWMA lag rate in production blend; ML gets (1 − ewmaBlendWeight). */
  ewmaBlendWeight?: number;
  /** Optional 3-way blend: ml + ewma + lag1 (most recent season rate). */
  blendWeights?: { ml: number; ewma: number; lag1: number };
  /** Fit on log(y + eps) for count-like per-game targets. */
  logTarget?: boolean;
  logEps?: number;
  holdoutR2?: number;
  productionStrategy?: ProductionStrategy;
}

export interface MlModelBundle {
  trainedAt: string;
  featureLags: number;
  minSeasonGp: number;
  skaterModels: RidgeModel[];
  skaterGpModel?: RidgeModel;
  skaterGpStrategy?: SkaterGpStrategyType;
  goalieModels: RidgeModel[];
  goalieGpModel: RidgeModel;
  goalieGpStrategy?: GoalieGpStrategyType;
  goalieModelsEvalOnly?: boolean;
  validationScheme?: string;
  metrics: {
    skater: Record<string, ModelMetrics>;
    goalie: Record<string, ModelMetrics>;
    goalieGp: ModelMetrics;
    skaterGp?: ModelMetrics;
  };
}

export interface ModelMetrics {
  samples: number;
  mae: number;
  rmse: number;
  mape: number;
  r2: number;
}
