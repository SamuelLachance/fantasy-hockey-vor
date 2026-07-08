import { ML_FEATURE_LAGS, ML_MIN_SEASON_GP } from "../nhl-api";
import { positionCode } from "./season-collector";
import {
  GOALIE_ML_TARGETS,
  SKATER_AUX_LAG_STATS,
  SKATER_ML_TARGETS,
  type PlayerSeasonRow,
  type SkaterMlTarget,
} from "./types";
import { targetAuxStats } from "./target-aux-stats";
import { targetCrossEwmaStats } from "./target-cross-stats";
import { teamChangedFlag, yearsOnCurrentTeam } from "./team-style";

const CONTEXT_LAG_FIELDS = [
  "teamElo",
  "teamPointPctg",
  "teamGoalsForPerGame",
  "teamGoalsAgainstPerGame",
  "teamGoalDiffPerGame",
  "teamLeagueRank",
  "capHitUsd",
  "coachTenureSeasons",
] as const;

/** Stats that are already rates or per-game from the API — not divided by GP again. */
const RATE_STATS = new Set([
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
  "shootingPct",
  "oZoneStartPct",
  "dZoneStartPct",
  "neutralZoneStartPct",
  "zoneStartPct5v5",
  "faceoffWinPct",
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
  "savePct",
  "xGoalsPer60",
  "onIceXGoalsPct",
  "offIceXGoalsPct",
  "onIceCorsiPct",
  "offIceCorsiPct",
  "onIceFenwickPct",
  "offIceFenwickPct",
  "gameScore",
]);

export const STATIC_CONTEXT_FEATURE_NAMES = [
  "age",
  "height_in",
  "weight_lb",
  "shoots_L",
  "draft_round",
  "draft_overall_pick",
  "years_since_draft",
  "cap_hit_m",
  "contract_years_remaining",
  "coach_id_norm",
  "team_gf_pg",
  "team_ga_pg",
  "team_goal_diff_pg",
  "team_league_rank_norm",
  "teams_in_lag_window",
  "team_hits_pg",
  "team_pim_pg",
  "team_blocks_pg",
  "team_pp_goal_share",
  "team_pk_ga_per60",
  "team_changed",
  "years_on_team_norm",
  "age_curve_mult",
  "team_offense_mult",
  "draft_pedigree_mult",
] as const;

export const CONTEXT_LAG_FEATURE_NAMES = CONTEXT_LAG_FIELDS.flatMap((field) => [
  `lag1_${field}`,
  `lag2_${field}`,
  `lag3_${field}`,
  `ewma_${field}`,
  `trend_${field}`,
]);

export const SKATER_AUX_LAG_FEATURE_NAMES = SKATER_AUX_LAG_STATS.flatMap((stat) => [
  `lag1_${stat}_pg`,
  `lag2_${stat}_pg`,
  `lag3_${stat}_pg`,
  `ewma_${stat}_pg`,
  `trend_${stat}_pg`,
]);

export const SKATER_FEATURE_NAMES = [
  "lag1_gp",
  "lag2_gp",
  "lag3_gp",
  "ewma_gp",
  "trend_gp",
  "pos_C",
  "pos_LW",
  "pos_RW",
  "pos_D",
  ...STATIC_CONTEXT_FEATURE_NAMES,
  ...CONTEXT_LAG_FEATURE_NAMES,
  ...SKATER_AUX_LAG_FEATURE_NAMES,
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
  ...STATIC_CONTEXT_FEATURE_NAMES.filter((n) => n !== "teams_in_lag_window"),
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

export const SKATER_GP_FEATURE_NAMES = GOALIE_GP_FEATURE_NAMES;

const EWMA_WEIGHTS = [0.15, 0.3, 0.55];

function perGame(total: number, gp: number): number {
  return gp > 0 ? total / gp : 0;
}

function seasonStartYear(seasonId: number): number {
  return Math.floor(seasonId / 10000);
}

function yearsSinceDraft(row: PlayerSeasonRow): number {
  const draftYear = row.draftYear ?? 0;
  if (draftYear <= 0) return 0;
  return Math.max(0, seasonStartYear(row.seasonId) - draftYear) / 20;
}

function ageCurveMultiplier(position: string, age: number): number {
  if (position === "D") {
    if (age <= 23) return 1.07;
    if (age <= 27) return 1.02;
    if (age >= 34) return 0.92;
    return 1;
  }
  if (age <= 22) return 1.09;
  if (age <= 26) return 1.04;
  if (age >= 33) return 0.91;
  if (age >= 36) return 0.84;
  return 1;
}

function draftPedigreeMultiplier(draftOverall: number, age: number): number {
  if (draftOverall <= 0) return 0.95;
  if (draftOverall <= 15 && age <= 26) return 1.08;
  if (draftOverall <= 50 && age <= 24) return 1.04;
  if (draftOverall >= 120) return 0.97;
  return 1;
}

function teamOffenseMultiplier(teamGfPg: number): number {
  return Math.max(0.75, Math.min(1.25, teamGfPg / 2.85));
}

function teamsInLagWindow(history: PlayerSeasonRow[]): number {
  const eligible = history
    .filter((h) => h.gamesPlayed >= ML_MIN_SEASON_GP)
    .slice(-ML_FEATURE_LAGS);
  const teams = new Set(
    eligible.map((h) => h.team.split(",")[0].trim().toUpperCase()).filter(Boolean),
  );
  return teams.size / 3;
}

function getStat(row: PlayerSeasonRow, target: string): number {
  if (target === "points") {
    return row.points ?? row.goals + row.assists;
  }
  return (row as unknown as Record<string, number>)[target] ?? 0;
}

function normalizeRate(raw: number, field: string): number {
  if (!Number.isFinite(raw) || raw === 0) return 0;
  if (
    field === "toiPerGame" ||
    field === "evToiPerGame" ||
    field === "ppToiPerGame" ||
    field === "shToiPerGame"
  ) {
    return raw / 60;
  }
  if (
    field === "shootingPct" ||
    field === "shootingPct5v5" ||
    field === "onIceShootingPct" ||
    field === "oZoneStartPct" ||
    field === "dZoneStartPct" ||
    field === "neutralZoneStartPct" ||
    field === "zoneStartPct5v5" ||
    field === "satPct" ||
    field === "usatPct" ||
    field === "ppToiPctPerGame" ||
    field === "faceoffWinPct" ||
    field === "savePct" ||
    field === "onIceXGoalsPct" ||
    field === "offIceXGoalsPct" ||
    field === "onIceCorsiPct" ||
    field === "offIceCorsiPct" ||
    field === "onIceFenwickPct" ||
    field === "offIceFenwickPct"
  ) {
    return raw > 1 ? raw / 100 : raw;
  }
  return raw;
}

function statValue(row: PlayerSeasonRow, target: string, usePerGame: boolean): number {
  const raw = getStat(row, target);
  if (target === "savePct") {
    return raw > 1 ? raw / 100 : raw;
  }
  const asRate = RATE_STATS.has(target);
  if (asRate) return normalizeRate(raw, target);
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
  if (field === "teamLeagueRank") return (row.teamLeagueRank ?? 16) / 32;
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
  history: PlayerSeasonRow[],
  includeTeamsInLag: boolean,
): { features: number[]; names: string[] } {
  const age = targetSeason.age ?? 0;
  const draftOverall = targetSeason.draftOverallPick ?? 0;
  const teamGf = targetSeason.teamGoalsForPerGame ?? 2.85;
  const features = [
    age,
    targetSeason.heightInches ?? 72,
    targetSeason.weightPounds ?? 190,
    targetSeason.shootsLeft ?? 0,
    (targetSeason.draftRound ?? 0) / 7,
    draftOverall / 224,
    yearsSinceDraft(targetSeason),
    (targetSeason.capHitUsd ?? 0) / 1_000_000,
    targetSeason.contractYearsRemaining ?? 0,
    (targetSeason.coachId ?? 0) / 10_000,
    teamGf,
    targetSeason.teamGoalsAgainstPerGame ?? 2.85,
    targetSeason.teamGoalDiffPerGame ?? 0,
    (targetSeason.teamLeagueRank ?? 16) / 32,
    includeTeamsInLag ? teamsInLagWindow(history) : 0,
    (targetSeason.teamHitsPerGame ?? 22) / 30,
    (targetSeason.teamPimPerGame ?? 8) / 12,
    (targetSeason.teamBlocksPerGame ?? 14) / 20,
    targetSeason.teamPpGoalShare ?? 0.2,
    (targetSeason.teamPkGaPer60 ?? 2.5) / 4,
    teamChangedFlag(history),
    yearsOnCurrentTeam(history) / 5,
    ageCurveMultiplier(targetSeason.position, age),
    teamOffenseMultiplier(teamGf),
    draftPedigreeMultiplier(draftOverall, age),
  ];
  const names = [...STATIC_CONTEXT_FEATURE_NAMES];
  if (!includeTeamsInLag) {
    return {
      features: features.slice(0, -1),
      names: names.filter((n) => n !== "teams_in_lag_window"),
    };
  }
  return { features, names };
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

function appendCrossEwmaFeatures(
  history: PlayerSeasonRow[],
  crossStats: readonly string[],
  primaryTargets: readonly string[],
  usePerGame: boolean,
  features: number[],
  names: string[],
): void {
  for (const stat of crossStats) {
    if (primaryTargets.includes(stat)) continue;
    const perGame = RATE_STATS.has(stat) ? false : usePerGame;
    const lags = lagValues(history, stat, perGame);
    features.push(ewma(lags));
    names.push(`ewma_${stat}_cross`);
  }
}

function appendStatLagFeatures(
  history: PlayerSeasonRow[],
  targets: readonly string[],
  usePerGame: boolean,
  features: number[],
  names: string[],
): void {
  for (const target of targets) {
    const perGame = RATE_STATS.has(target) ? false : usePerGame;
    const lags = lagValues(history, target, perGame);
    features.push(...lags, ewma(lags), trend(lags));
    names.push(
      `lag1_${target}_pg`,
      `lag2_${target}_pg`,
      `lag3_${target}_pg`,
      `ewma_${target}_pg`,
      `trend_${target}_pg`,
    );
  }
}

function buildLagFeatures(
  history: PlayerSeasonRow[],
  targets: readonly string[],
  usePerGame: boolean,
  includePosition: boolean,
  targetSeason?: PlayerSeasonRow,
  skaterTarget?: SkaterMlTarget,
  gpOnly = false,
): { features: number[]; names: string[] } {
  const gpLags = lagValues(history, "gamesPlayed", false);
  const features: number[] = [...gpLags, ewma(gpLags), trend(gpLags)];
  const names: string[] = [
    "lag1_gp",
    "lag2_gp",
    "lag3_gp",
    "ewma_gp",
    "trend_gp",
  ];

  if (includePosition) {
    const pos = history[history.length - 1]?.position ?? "C";
    features.push(...positionCode(pos));
    names.push("pos_C", "pos_LW", "pos_RW", "pos_D");
  } else if (!targetSeason) {
    features.push(history[history.length - 1]?.teamGoalsForPerGame ?? 2.85);
    names.push("team_gf_pg");
  }

  if (targetSeason) {
    const staticCtx = buildStaticContextFeatures(
      targetSeason,
      history,
      includePosition,
    );
    if (includePosition) {
      features.push(...staticCtx.features);
      names.push(...staticCtx.names);
    } else {
      const filtered = buildStaticContextFeatures(targetSeason, history, false);
      features.push(...filtered.features);
      names.push(...filtered.names);
    }
  }

  const ctxLags = buildContextLagFeatures(history);
  features.push(...ctxLags.features);
  names.push(...ctxLags.names);

  if (includePosition && !gpOnly) {
    const aux = skaterTarget ? targetAuxStats(skaterTarget) : SKATER_AUX_LAG_STATS;
    appendStatLagFeatures(history, aux, true, features, names);
    if (skaterTarget) {
      appendCrossEwmaFeatures(
        history,
        targetCrossEwmaStats(skaterTarget),
        targets,
        true,
        features,
        names,
      );
    }
  }

  appendStatLagFeatures(history, targets, usePerGame, features, names);

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
        target,
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

export function buildSkaterGpExamples(rows: PlayerSeasonRow[]): TrainingExample[] {
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
      const target = history[i];
      if (target.gamesPlayed < ML_MIN_SEASON_GP) continue;
      const prior = history.slice(0, i);
      const { features, names } = buildLagFeatures(
        prior,
        [],
        false,
        true,
        target,
        undefined,
        true,
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

export function extractEwmaFeature(
  featureNames: string[],
  features: number[],
  target: string,
): number {
  const key = `ewma_${target}_pg`;
  const i = featureNames.indexOf(key);
  return i >= 0 ? features[i] : 0;
}

export function extractLag1Feature(
  featureNames: string[],
  features: number[],
  target: string,
): number {
  const key = `lag1_${target}_pg`;
  const i = featureNames.indexOf(key);
  return i >= 0 ? features[i] : 0;
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
    isGoalie ? undefined : (target as SkaterMlTarget),
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
      teamGoalsAgainstPerGame: 2.85,
      teamGoalDiffPerGame: 0,
    };
  }
  return {
    ...last,
    seasonId: last.seasonId + 10001,
    age: (last.age ?? 25) + 1,
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

export function buildSkaterGpInferenceFeatures(
  history: PlayerSeasonRow[],
  targetSeason?: PlayerSeasonRow,
): { features: number[]; featureNames: string[] } {
  const projectionRow = targetSeason ?? syntheticTargetRow(history, false);
  const { features, names } = buildLagFeatures(
    history,
    [],
    false,
    true,
    projectionRow,
    undefined,
    true,
  );
  return { features, featureNames: names };
}
