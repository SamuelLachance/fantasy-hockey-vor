import { ML_FEATURE_LAGS, ML_MIN_SEASON_GP } from "../nhl-api";
import { positionCode } from "./season-collector";
import {
  GOALIE_ML_TARGETS,
  SKATER_ML_TARGETS,
  type PlayerSeasonRow,
  type SkaterMlTarget,
} from "./types";

const CONTEXT_LAG_FIELDS = [
  "teamElo",
  "teamPointPctg",
  "capHitUsd",
  "coachTenureSeasons",
] as const;

export const STATIC_CONTEXT_FEATURE_NAMES = [
  "age",
  "height_in",
  "weight_lb",
  "shoots_L",
  "draft_round",
  "draft_overall_log",
  "years_since_draft",
  "cap_hit_m",
  "contract_years_remaining",
  "coach_id_norm",
] as const;

export const CONTEXT_LAG_FEATURE_NAMES = CONTEXT_LAG_FIELDS.flatMap((field) => [
  `lag1_${field}`,
  `lag2_${field}`,
  `lag3_${field}`,
  `ewma_${field}`,
  `trend_${field}`,
]);

export const SKATER_FEATURE_NAMES = [
  "lag1_gp",
  "lag2_gp",
  "lag3_gp",
  "ewma_gp",
  "trend_gp",
  "team_gf_pg",
  "pos_C",
  "pos_LW",
  "pos_RW",
  "pos_D",
  ...STATIC_CONTEXT_FEATURE_NAMES,
  ...CONTEXT_LAG_FEATURE_NAMES,
  ...SKATER_ML_TARGETS.flatMap((target) => [
    `lag1_${target}_pg`,
    `lag2_${target}_pg`,
    `lag3_${target}_pg`,
    `ewma_${target}_pg`,
    `trend_${target}_pg`,
  ]),
] as const;

export const GOALIE_FEATURE_NAMES = [
  "lag1_gp",
  "lag2_gp",
  "lag3_gp",
  "ewma_gp",
  "trend_gp",
  "team_gf_pg",
  ...STATIC_CONTEXT_FEATURE_NAMES,
  ...CONTEXT_LAG_FEATURE_NAMES,
  ...(["wins", "shutouts", "saves", "savePct"] as const).flatMap((target) => [
    `lag1_${target}_pg`,
    `lag2_${target}_pg`,
    `lag3_${target}_pg`,
    `ewma_${target}_pg`,
    `trend_${target}_pg`,
  ]),
] as const;

export const GOALIE_GP_FEATURE_NAMES = [
  "lag1_gp",
  "lag2_gp",
  "lag3_gp",
  "ewma_gp",
  "trend_gp",
] as const;

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];

function perGame(total: number, gp: number): number {
  return gp > 0 ? total / gp : 0;
}

function getStat(row: PlayerSeasonRow, target: string): number {
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

function statValue(row: PlayerSeasonRow, target: string, usePerGame: boolean): number {
  const raw = getStat(row, target);
  if (target === "savePct") {
    return raw > 1 ? raw / 100 : raw;
  }
  return usePerGame ? perGame(raw, row.gamesPlayed) : raw;
}

function lagValues(
  history: PlayerSeasonRow[],
  target: string,
  usePerGame: boolean,
): number[] {
  const eligible = history.filter((h) => h.gamesPlayed >= ML_MIN_SEASON_GP);
  const recent = eligible.slice(-ML_FEATURE_LAGS);
  const values: number[] = [];
  for (let i = ML_FEATURE_LAGS; i > 0; i--) {
    const row = recent[recent.length - i];
    if (!row) {
      values.push(0);
      continue;
    }
    values.push(statValue(row, target, usePerGame));
  }
  while (values.length < ML_FEATURE_LAGS) values.unshift(0);
  return values;
}

function ewma(values: number[]): number {
  const weights = EWMA_WEIGHTS.slice(-values.filter((v) => v > 0 || values.indexOf(v) === values.length - 1).length);
  if (weights.length === 0) return 0;
  const totalW = weights.reduce((a, b) => a + b, 0);
  const slice = values.slice(-weights.length);
  return slice.reduce((sum, v, i) => sum + v * (weights[i] / totalW), 0);
}

function trend(values: number[]): number {
  if (values.length < 2) return 0;
  const a = values[values.length - 2];
  const b = values[values.length - 1];
  if (a <= 0) return 0;
  return (b - a) / a;
}

function contextFieldValue(row: PlayerSeasonRow, field: string): number {
  if (field === "capHitUsd") return (row.capHitUsd ?? 0) / 1_000_000;
  return (row as unknown as Record<string, number>)[field] ?? 0;
}

function contextLagValues(
  history: PlayerSeasonRow[],
  field: string,
): number[] {
  const eligible = history.filter((h) => h.gamesPlayed >= ML_MIN_SEASON_GP);
  const recent = eligible.slice(-ML_FEATURE_LAGS);
  const values: number[] = [];
  for (let i = ML_FEATURE_LAGS; i > 0; i--) {
    const row = recent[recent.length - i];
    values.push(row ? contextFieldValue(row, field) : 0);
  }
  while (values.length < ML_FEATURE_LAGS) values.unshift(0);
  return values;
}

function buildStaticContextFeatures(
  targetSeason: PlayerSeasonRow,
): { features: number[]; names: string[] } {
  const features = [
    targetSeason.age ?? 0,
    targetSeason.heightInches ?? 72,
    targetSeason.weightPounds ?? 190,
    targetSeason.shootsLeft ?? 0,
    targetSeason.draftRound ?? 0,
    targetSeason.draftOverallLog ?? Math.log(999),
    targetSeason.yearsSinceDraft ?? 0,
    (targetSeason.capHitUsd ?? 0) / 1_000_000,
    targetSeason.contractYearsRemaining ?? 0,
    (targetSeason.coachId ?? 0) / 10_000,
  ];
  return { features, names: [...STATIC_CONTEXT_FEATURE_NAMES] };
}

function buildContextLagFeatures(
  history: PlayerSeasonRow[],
): { features: number[]; names: string[] } {
  const features: number[] = [];
  const names: string[] = [];

  for (const field of CONTEXT_LAG_FIELDS) {
    const lags = contextLagValues(history, field);
    features.push(...lags, ewma(lags), trend(lags));
    names.push(
      `lag1_${field}`,
      `lag2_${field}`,
      `lag3_${field}`,
      `ewma_${field}`,
      `trend_${field}`,
    );
  }

  return { features, names };
}

function buildLagFeatures(
  history: PlayerSeasonRow[],
  targets: readonly string[],
  usePerGame: boolean,
  includePosition: boolean,
  targetSeason?: PlayerSeasonRow,
): { features: number[]; names: string[] } {
  const gpLags = lagValues(history, "gamesPlayed", false);
  const features: number[] = [
    ...gpLags,
    ewma(gpLags),
    trend(gpLags),
    history[history.length - 1]?.teamGoalsForPerGame ?? 2.85,
  ];
  const names: string[] = [
    "lag1_gp",
    "lag2_gp",
    "lag3_gp",
    "ewma_gp",
    "trend_gp",
    "team_gf_pg",
  ];

  if (includePosition) {
    const pos = history[history.length - 1]?.position ?? "C";
    features.push(...positionCode(pos));
    names.push("pos_C", "pos_LW", "pos_RW", "pos_D");
  }

  if (targetSeason) {
    const staticCtx = buildStaticContextFeatures(targetSeason);
    features.push(...staticCtx.features);
    names.push(...staticCtx.names);
  }

  const ctxLags = buildContextLagFeatures(history);
  features.push(...ctxLags.features);
  names.push(...ctxLags.names);

  for (const target of targets) {
    const lags = lagValues(history, target, usePerGame);
    features.push(...lags, ewma(lags), trend(lags));
    names.push(
      `lag1_${target}_pg`,
      `lag2_${target}_pg`,
      `lag3_${target}_pg`,
      `ewma_${target}_pg`,
      `trend_${target}_pg`,
    );
  }

  return { features, names };
}

export interface TrainingExample {
  playerId: number;
  seasonId: number;
  targetSeason: PlayerSeasonRow;
  features: number[];
  featureNames: string[];
}

export function buildSkaterTrainingExamplesForTarget(
  rows: PlayerSeasonRow[],
  target: SkaterMlTarget,
): TrainingExample[] {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows.filter((r) => !r.isGoalie)) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  const examples: TrainingExample[] = [];
  for (const history of byPlayer.values()) {
    history.sort((a, b) => a.seasonId - b.seasonId);
    for (let i = ML_FEATURE_LAGS; i < history.length; i++) {
      const targetSeason = history[i];
      if (targetSeason.gamesPlayed < ML_MIN_SEASON_GP) continue;
      const prior = history.slice(0, i);
      const { features, names } = buildLagFeatures(
        prior,
        [target],
        true,
        true,
        targetSeason,
      );
      examples.push({
        playerId: targetSeason.playerId,
        seasonId: targetSeason.seasonId,
        targetSeason,
        features,
        featureNames: names,
      });
    }
  }
  return examples;
}

export function buildSkaterTrainingExamples(
  rows: PlayerSeasonRow[],
): TrainingExample[] {
  return buildSkaterTrainingExamplesForTarget(rows, "goals");
}

export function buildGoalieTrainingExamplesForTarget(
  rows: PlayerSeasonRow[],
  target: string,
): TrainingExample[] {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows.filter((r) => r.isGoalie)) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  const examples: TrainingExample[] = [];
  for (const history of byPlayer.values()) {
    history.sort((a, b) => a.seasonId - b.seasonId);
    for (let i = ML_FEATURE_LAGS; i < history.length; i++) {
      const targetSeason = history[i];
      if (targetSeason.gamesPlayed < ML_MIN_SEASON_GP) continue;
      const prior = history.slice(0, i);
      const { features, names } = buildLagFeatures(
        prior,
        [target],
        true,
        false,
        targetSeason,
      );
      examples.push({
        playerId: targetSeason.playerId,
        seasonId: targetSeason.seasonId,
        targetSeason,
        features,
        featureNames: names,
      });
    }
  }
  return examples;
}

export function buildGoalieTrainingExamples(
  rows: PlayerSeasonRow[],
): TrainingExample[] {
  return buildGoalieTrainingExamplesForTarget(rows, "wins");
}

export function buildGoalieGpExamples(rows: PlayerSeasonRow[]): TrainingExample[] {
  const byPlayer = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows.filter((r) => r.isGoalie)) {
    const list = byPlayer.get(row.playerId) ?? [];
    list.push(row);
    byPlayer.set(row.playerId, list);
  }

  const examples: TrainingExample[] = [];
  for (const history of byPlayer.values()) {
    history.sort((a, b) => a.seasonId - b.seasonId);
    for (let i = ML_FEATURE_LAGS; i < history.length; i++) {
      const target = history[i];
      if (target.gamesPlayed < ML_MIN_SEASON_GP) continue;
      const prior = history.slice(0, i);
      const { features, names } = buildLagFeatures(
        prior,
        [],
        false,
        false,
        target,
      );
      examples.push({
        playerId: target.playerId,
        seasonId: target.seasonId,
        targetSeason: target,
        features,
        featureNames: names,
      });
    }
  }
  return examples;
}

export function skaterTargetValue(
  example: TrainingExample,
  target: SkaterMlTarget,
): number {
  const row = example.targetSeason;
  return perGame(getStat(row, target), row.gamesPlayed);
}

export function goalieTargetValue(
  example: TrainingExample,
  target: string,
): number {
  const row = example.targetSeason;
  if (target === "savePct") {
    return row.savePct > 1 ? row.savePct / 100 : row.savePct;
  }
  return perGame(getStat(row, target), row.gamesPlayed);
}

export function buildTargetInferenceFeatures(
  history: PlayerSeasonRow[],
  target: string,
  isGoalie: boolean,
  targetSeason?: PlayerSeasonRow,
): { features: number[]; featureNames: string[] } {
  const projectionRow = targetSeason ?? syntheticTargetRow(history, isGoalie);
  const { features, names } = buildLagFeatures(
    history,
    [target],
    true,
    !isGoalie,
    projectionRow,
  );
  return { features, featureNames: names };
}

function syntheticTargetRow(
  history: PlayerSeasonRow[],
  isGoalie: boolean,
): PlayerSeasonRow {
  const last = history[history.length - 1];
  if (!last) {
    return {
      playerId: 0,
      name: "",
      seasonId: 20262027,
      team: "",
      position: isGoalie ? "G" : "C",
      isGoalie,
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
      teamGoalsForPerGame: 2.85,
    };
  }
  return {
    ...last,
    seasonId: last.seasonId + 10001,
    age: (last.age ?? 25) + 1,
    yearsSinceDraft: (last.yearsSinceDraft ?? 0) + 1,
    contractYearsRemaining: Math.max(0, (last.contractYearsRemaining ?? 0) - 1),
  };
}

export function buildInferenceFeatures(
  history: PlayerSeasonRow[],
  isGoalie: boolean,
  targetSeason?: PlayerSeasonRow,
): { features: number[]; featureNames: string[] } {
  if (isGoalie) {
    return buildTargetInferenceFeatures(history, "wins", true, targetSeason);
  }
  return buildTargetInferenceFeatures(history, "goals", false, targetSeason);
}

export function buildGoalieGpInferenceFeatures(
  history: PlayerSeasonRow[],
  targetSeason?: PlayerSeasonRow,
): { features: number[]; featureNames: string[] } {
  const projectionRow = targetSeason ?? syntheticTargetRow(history, true);
  const { features, names } = buildLagFeatures(
    history,
    [],
    false,
    false,
    projectionRow,
  );
  return { features, featureNames: names };
}
