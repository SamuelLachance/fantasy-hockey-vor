import type { PlayerProfile } from "../profile-types";
import type { TrainingExample } from "./features";
import { predictRidge } from "./ridge";
import {
  clampGp,
  durabilityFromGpHistory,
  extractEwmaGp,
  extractLag1Gp,
  injuryGpFromProfile,
} from "./gp-predict";
import type {
  GpEnsembleWeights,
  GpTwoStepConfig,
  PlayerSeasonRow,
  RidgeModel,
} from "./types";

const FULL_SEASON = 82;

function priorHistoryForExample(
  historyMap: Map<number, PlayerSeasonRow[]>,
  example: TrainingExample,
): PlayerSeasonRow[] {
  const history = historyMap.get(example.playerId) ?? [];
  const idx = history.findIndex((r) => r.seasonId === example.seasonId);
  return idx > 0 ? history.slice(0, idx) : [];
}

export interface GpSignals {
  lag1: number;
  ewma: number;
  durability: number;
  age: number;
}

export function defaultTwoStepConfig(isGoalie: boolean): GpTwoStepConfig {
  if (isGoalie) {
    return {
      labelMinGp: 35,
      classifyLag1Min: 32,
      classifyEwmaMin: 0,
      durabilityMin: 0.55,
      fullSeasonGp: 58,
      partialEnsembleWeights: { lag1: 0.2, ewma: 0.3, ml: 0.4, injury: 0.1 },
    };
  }
  return {
    labelMinGp: 65,
    classifyLag1Min: 62,
    classifyEwmaMin: 0,
    durabilityMin: 0.6,
    fullSeasonGp: 80,
    partialEnsembleWeights: { lag1: 0.15, ewma: 0.25, ml: 0.5, injury: 0.1 },
  };
}

export function gpSignalsFromExample(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
): GpSignals {
  const lag1 = extractLag1Gp(ex.featureNames, ex.features);
  const ewma = extractEwmaGp(ex.featureNames, ex.features);
  const gps = prior
    .filter((r) => r.gamesPlayed >= 10)
    .slice(-3)
    .map((r) => r.gamesPlayed);
  return {
    lag1,
    ewma,
    durability: durabilityFromGpHistory(gps),
    age: ex.targetSeason.age ?? 27,
  };
}

export function gpSignalsFromProfile(
  profile: PlayerProfile,
  isGoalie: boolean,
): GpSignals {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie === isGoalie);
  const recent = seasons.filter((s) => s.gamesPlayed >= 10).slice(-3);
  const lag1 = recent.at(-1)?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 0;
  const ewma =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.gamesPlayed, 0) / recent.length
      : lag1;
  const gps = recent.map((r) => r.gamesPlayed);
  return {
    lag1,
    ewma,
    durability: profile.injury.durabilityScore || durabilityFromGpHistory(gps),
    age: profile.bio.age,
  };
}

export function isProjectedFullSeason(
  signals: GpSignals,
  config: GpTwoStepConfig,
): boolean {
  if (signals.lag1 < config.classifyLag1Min) return false;
  if (signals.durability < config.durabilityMin) return false;
  if (config.classifyEwmaMin > 0 && signals.ewma < config.classifyEwmaMin) {
    return false;
  }
  return true;
}

function ageGpMult(age: number, isGoalie: boolean): number {
  if (isGoalie) {
    if (age >= 37) return 0.9;
    if (age >= 34) return 0.95;
    if (age <= 24) return 1.03;
    return 1;
  }
  if (age >= 36) return 0.94;
  if (age >= 33) return 0.97;
  if (age <= 22) return 1.03;
  return 1;
}

function partialGpFromSignals(
  signals: GpSignals,
  mlGp: number,
  injuryGp: number,
  weights: GpEnsembleWeights,
): number {
  const ml = mlGp > 0 ? mlGp : signals.lag1;
  return clampGp(
    signals.lag1 * weights.lag1 +
      signals.ewma * weights.ewma +
      ml * weights.ml +
      injuryGp * weights.injury,
  );
}

export function predictTwoStepGpFromSignals(
  signals: GpSignals,
  mlGp: number,
  injuryGp: number,
  config: GpTwoStepConfig,
  isGoalie: boolean,
): number {
  if (isProjectedFullSeason(signals, config)) {
    const durMult = 0.9 + 0.1 * signals.durability;
    const ageMult = ageGpMult(signals.age, isGoalie);
    const target = config.fullSeasonGp * durMult * ageMult;
    return clampGp(Math.max(target, signals.lag1 * 0.92));
  }
  return partialGpFromSignals(
    signals,
    mlGp,
    injuryGp,
    config.partialEnsembleWeights,
  );
}

export function predictTwoStepGpFromExample(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  gpModel: RidgeModel,
  config: GpTwoStepConfig,
  isGoalie: boolean,
  injuryGp: number,
): number {
  const signals = gpSignalsFromExample(ex, prior);
  const mlGp = predictRidge(gpModel, ex.features);
  return predictTwoStepGpFromSignals(signals, mlGp, injuryGp, config, isGoalie);
}

/** Mirrors predictTwoStepGpFromExample — pass trendGp for goalies (same as training). */
export function predictTwoStepGpFromProfile(
  profile: PlayerProfile,
  mlGp: number | null | undefined,
  config: GpTwoStepConfig,
  isGoalie: boolean,
  injuryGp?: number,
): number {
  const signals = gpSignalsFromProfile(profile, isGoalie);
  const injury = isGoalie
    ? (injuryGp ?? signals.lag1)
    : injuryGpFromProfile(profile);
  const ml = mlGp != null && mlGp > 0 ? mlGp : signals.lag1;
  return predictTwoStepGpFromSignals(signals, ml, injury, config, isGoalie);
}

export function fullSeasonLabel(actualGp: number, config: GpTwoStepConfig): boolean {
  return actualGp >= config.labelMinGp;
}

export function classificationAccuracy(
  yTrue: number[],
  yPred: number[],
  config: GpTwoStepConfig,
): number {
  if (yTrue.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < yTrue.length; i++) {
    const actual = fullSeasonLabel(yTrue[i], config);
    const predicted = fullSeasonLabel(yPred[i], config);
    if (actual === predicted) hits++;
  }
  return hits / yTrue.length;
}

export function within10Accuracy(yTrue: number[], yPred: number[]): number {
  if (yTrue.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < yTrue.length; i++) {
    if (Math.abs(yTrue[i] - yPred[i]) <= 10) hits++;
  }
  return hits / yTrue.length;
}

export function tuneTwoStepConfig(
  examples: TrainingExample[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  gpModel: RidgeModel,
  isGoalie: boolean,
  partialWeights: GpEnsembleWeights,
  injuryGpFn: (prior: PlayerSeasonRow[]) => number,
): GpTwoStepConfig {
  const base = defaultTwoStepConfig(isGoalie);
  base.partialEnsembleWeights = partialWeights;

  if (examples.length === 0) return base;

  const y = examples.map((ex) => ex.targetSeason.gamesPlayed);
  let best = base;
  let bestScore = -Infinity;

  const lag1Grid = isGoalie
    ? [22, 26, 28, 30, 32, 34, 36, 38, 40]
    : [52, 55, 58, 60, 62, 64, 66, 68];
  const ewmaGrid = isGoalie ? [0, 24, 28, 32] : [0, 52, 55, 58, 60];
  const durGrid = [0.5, 0.6, 0.7, 0.8];
  const gpGrid = isGoalie ? [52, 55, 58, 60, 62] : [74, 76, 78, 80, 82];

  for (const classifyLag1Min of lag1Grid) {
    for (const classifyEwmaMin of ewmaGrid) {
      for (const durabilityMin of durGrid) {
        for (const fullSeasonGp of gpGrid) {
          const config: GpTwoStepConfig = {
            ...base,
            classifyLag1Min,
            classifyEwmaMin,
            durabilityMin,
            fullSeasonGp,
          };
          const preds = examples.map((ex) => {
            const prior = priorHistoryForExample(historyMap, ex);
            return predictTwoStepGpFromExample(
              ex,
              prior,
              gpModel,
              config,
              isGoalie,
              injuryGpFn(prior),
            );
          });
          const classAcc = classificationAccuracy(y, preds, config);
          const w10 = within10Accuracy(y, preds);
          let ssRes = 0;
          let ssTot = 0;
          const yBar = y.reduce((a, b) => a + b, 0) / y.length;
          for (let i = 0; i < y.length; i++) {
            ssRes += (y[i] - preds[i]) ** 2;
            ssTot += (y[i] - yBar) ** 2;
          }
          const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
          const score = classAcc * 0.55 + w10 * 0.3 + r2 * 0.15;
          if (score > bestScore) {
            bestScore = score;
            best = config;
          }
        }
      }
    }
  }

  return best;
}
