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

/** Skater categories shown for defensemen (no faceoffs). */
export const DEFENSE_SKATER_CATEGORIES = [
  "goals",
  "assists",
  "shots",
  "blocks",
  "hits",
  "powerplayPoints",
  "penaltyMinutes",
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

/**
 * Uncertainty on a single projected stat (season-total scale, matching the
 * projection). `sigma² = aleatoric² + modelSpread²`.
 */
export interface StatUncertainty {
  /** Combined 1σ band on the projected season total. */
  sigma: number;
  /** Irreducible share (Bayes floor from the stat's YoY reliability). */
  aleatoric: number;
  /** Reducible share (disagreement among the base signals for this player). */
  modelSpread: number;
}

/**
 * Calibrated uncertainty attached to a projection. Reported, never used to
 * shrink the point estimate — it tells you how much to trust the number, and
 * how much of the doubt is beatable (modelSpread) vs irreducible (aleatoric).
 */
export interface ProjectionUncertainty {
  /** 1σ on games played (games). */
  gamesPlayedSigma: number;
  /** 1σ on each projected season-total stat. */
  perStat: Partial<Record<Category, StatUncertainty>>;
  /** Quadrature aggregate across the player's scored categories. */
  total: StatUncertainty;
  /**
   * Fraction of total variance that is irreducible, in [0, 1]. High → the
   * reliability ceiling is the limit and more modelling won't help; low → the
   * base models disagree and better information could still sharpen this
   * player.
   */
  aleatoricShare: number;
}

export interface PlayerProjection {
  id: number;
  name: string;
  team: string;
  /** Best Yahoo roster slot for VOR (max across eligible positions). */
  position: Position;
  /** Yahoo Fantasy eligible roster positions (C/LW/RW/D/G). */
  positions: Position[];
  /** Position used for VOR calculation (same as position after applyVor). */
  vorPosition?: Position;
  /** VOR at each Yahoo-eligible roster position. */
  vorByPosition?: Partial<Record<Position, number>>;
  /** Whether positions came from Yahoo or NHL fallback. */
  positionSource?: "yahoo" | "nhl";
  isGoalie: boolean;
  gamesPlayed: number;
  projection: SkaterProjection | GoalieProjection;
  categoryZScores: Partial<Record<Category, number>>;
  fantasyValue: number;
  vor: number;
  rank: number;
  positionRank: number;
  projectionMethod?: "ml" | "ai" | "contextual";
  confidence?: number;
  reasoning?: string;
  profileSummary?: string;
  /** Per-stat model − synthetic-market rate (per game), when market training is on. */
  marketEdge?: Partial<Record<Category, number>>;
  /** Calibrated projection uncertainty (v2 ML skaters). */
  uncertainty?: ProjectionUncertainty;
  /** Rank if ordered by synthetic-market-only fantasy value (1 = best). */
  syntheticMarketRank?: number;
  /** syntheticMarketRank − rank: positive = undervalued vs consensus. */
  draftValue?: number;
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
  /**
   * Multiplier on goalie fantasy value (and therefore VOR). H2H category
   * leagues discount goalies: weekly start counts are volatile, the goalie
   * categories are streamable, and W/SO/SV% are the noisiest projections.
   */
  goalieVorFactor?: number;
}

export interface DataManifest {
  profilesCollectedAt: string | null;
  modelsTrainedAt: string | null;
  contextCacheBuiltAt: string | null;
  yahooPositionsFetchedAt: string | null;
  aiCacheGeneratedAt: string | null;
}

export interface ProjectionsDataset {
  generatedAt: string;
  season: string;
  league: LeagueSettings;
  /** Provenance of upstream data artifacts. */
  dataManifest?: DataManifest;
  replacementLevels: Partial<Record<Position, number>>;
  /** Per-category scarcity weights used in weighted fantasy value / VOR. */
  categoryWeights?: import("./stat-difficulty").CategoryDifficultyWeights;
  projectionEngine: string;
  positionSource?: "yahoo-fantasy" | "nhl-fallback";
  yahooPositionsFetchedAt?: string;
  aiModel?: string;
  players: PlayerProjection[];
}
