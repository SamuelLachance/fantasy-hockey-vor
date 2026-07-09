import type { PlayerProfile } from "../profile-types";
import type {
  GoalieGpStrategyType,
  GpEnsembleWeights,
  GpLag1EwmaBlend,
  GpTwoStepConfig,
  SkaterGpStrategyType,
} from "./types";
import { predictTwoStepGpFromProfile } from "./gp-two-step";

const FULL_SEASON = 82;

export const DEFAULT_GP_LAG1_EWMA: GpLag1EwmaBlend = { lag1: 0.72, ewma: 0.28 };

export function extractLag1Gp(featureNames: string[], features: number[]): number {
  const i = featureNames.indexOf("lag1_gp");
  return i >= 0 ? features[i] : 0;
}

export function extractEwmaGp(featureNames: string[], features: number[]): number {
  const i = featureNames.indexOf("ewma_gp");
  return i >= 0 ? features[i] : 0;
}

function skaterAgeGpMult(age: number): number {
  if (age >= 36) return 0.9;
  if (age >= 33) return 0.95;
  if (age <= 22) return 1.04;
  if (age <= 24) return 1.02;
  return 1;
}

function goalieAgeGpMult(age: number): number {
  if (age >= 37) return 0.88;
  if (age >= 34) return 0.94;
  if (age <= 24) return 1.04;
  return 1;
}

export function durabilityFromGpHistory(gps: number[]): number {
  if (gps.length === 0) return 0.85;
  const mean = gps.reduce((a, b) => a + b, 0) / gps.length;
  const variance =
    gps.reduce((s, g) => s + (g - mean) ** 2, 0) / Math.max(1, gps.length);
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0.2;
  return Math.max(0.55, Math.min(1, 1 - cv * 0.45));
}

export function clampGp(gp: number): number {
  return Math.max(10, Math.min(FULL_SEASON, Math.round(gp)));
}

/** Cap GP for players with limited NHL history. */
export function capYoungSkaterGp(gp: number, profile: PlayerProfile): number {
  const seasons = profile.teamHistory.filter(
    (s) => !s.isGoalie && s.gamesPlayed >= 10,
  );
  const n = seasons.length;
  if (n >= 3) return gp;
  const maxPrior = Math.max(0, ...seasons.map((s) => s.gamesPlayed));
  if (n === 0) return Math.min(gp, 62);
  if (n === 1) return Math.min(gp, Math.round(maxPrior * 1.08 + 6));
  return Math.min(gp, Math.round(maxPrior * 1.12 + 10));
}

export function lag1EwmaGp(
  lag1: number,
  ewma: number,
  blend: GpLag1EwmaBlend,
  age: number,
  isGoalie: boolean,
  durability: number,
): number {
  void age;
  void isGoalie;
  void durability;
  const base = lag1 * blend.lag1 + ewma * blend.ewma;
  if (base <= 0) return FULL_SEASON;
  return clampGp(base);
}

export function lag1GpFromProfile(profile: PlayerProfile, isGoalie: boolean): number {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie === isGoalie);
  const recent = seasons.filter((s) => s.gamesPlayed >= 10).slice(-3);
  const lag1 = recent.at(-1)?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 0;
  const ewma =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.gamesPlayed, 0) / recent.length
      : lag1;
  const gps = recent.map((r) => r.gamesPlayed);
  const durability = profile.injury.durabilityScore || durabilityFromGpHistory(gps);
  return lag1EwmaGp(
    lag1,
    ewma,
    { lag1: 1, ewma: 0 },
    profile.bio.age,
    isGoalie,
    durability,
  );
}

export function ewmaGpFromProfile(profile: PlayerProfile, isGoalie: boolean): number {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie === isGoalie);
  const recent = seasons.filter((s) => s.gamesPlayed >= 10).slice(-3);
  const lag1 = recent.at(-1)?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 0;
  const ewma =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.gamesPlayed, 0) / recent.length
      : lag1;
  const gps = recent.map((r) => r.gamesPlayed);
  const durability = profile.injury.durabilityScore || durabilityFromGpHistory(gps);
  return lag1EwmaGp(
    lag1,
    ewma,
    { lag1: 0, ewma: 1 },
    profile.bio.age,
    isGoalie,
    durability,
  );
}

export function lag1EwmaGpFromProfile(
  profile: PlayerProfile,
  isGoalie: boolean,
  blend: GpLag1EwmaBlend,
): number {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie === isGoalie);
  const recent = seasons.filter((s) => s.gamesPlayed >= 10).slice(-3);
  const lag1 = recent.at(-1)?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 0;
  const ewma =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.gamesPlayed, 0) / recent.length
      : lag1;
  const gps = recent.map((r) => r.gamesPlayed);
  const durability = profile.injury.durabilityScore || durabilityFromGpHistory(gps);
  return lag1EwmaGp(lag1, ewma, blend, profile.bio.age, isGoalie, durability);
}

export function injuryGpFromProfile(profile: PlayerProfile): number {
  const injury = profile.injury;
  const baseGp =
    injury.avgGamesPlayedLast3 > 0
      ? injury.avgGamesPlayedLast3
      : injury.gamesPlayedLastSeason > 0
        ? injury.gamesPlayedLastSeason
        : FULL_SEASON;
  let gp = Math.round(baseGp * (0.82 + 0.18 * injury.durabilityScore));
  if (injury.trend === "injury_prone") gp = Math.round(gp * 0.92);
  else if (injury.trend === "healthy" && injury.durabilityScore >= 0.9) {
    gp = Math.round(gp * 1.02);
  }
  return clampGp(gp);
}

export function ensembleGpFromProfile(
  profile: PlayerProfile,
  isGoalie: boolean,
  mlGp: number | null | undefined,
  weights: GpEnsembleWeights,
): number {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie === isGoalie);
  const recent = seasons.filter((s) => s.gamesPlayed >= 10).slice(-3);
  const lag1 = recent.at(-1)?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 82;
  const ewma =
    recent.length > 0
      ? recent.reduce((s, r) => s + r.gamesPlayed, 0) / recent.length
      : lag1;
  const injury = injuryGpFromProfile(profile);
  const ml = mlGp != null && mlGp > 0 ? mlGp : lag1;
  return clampGp(
    lag1 * weights.lag1 +
      ewma * weights.ewma +
      ml * weights.ml +
      injury * weights.injury,
  );
}

export function predictSkaterGpFromStrategy(
  strategy: SkaterGpStrategyType,
  profile: PlayerProfile,
  mlGp: number | null | undefined,
  lag1EwmaBlend: GpLag1EwmaBlend,
  injuryGp: number,
  ensembleWeights?: GpEnsembleWeights,
  twoStepConfig?: GpTwoStepConfig,
): number {
  if (strategy === "two_step_full_season" && twoStepConfig) {
    return capYoungSkaterGp(
      predictTwoStepGpFromProfile(profile, mlGp, twoStepConfig, false),
      profile,
    );
  }
  if (strategy === "ensemble" && ensembleWeights) {
    return capYoungSkaterGp(
      ensembleGpFromProfile(profile, false, mlGp, ensembleWeights),
      profile,
    );
  }
  switch (strategy) {
    case "lag1_only":
      return capYoungSkaterGp(lag1GpFromProfile(profile, false), profile);
    case "ewma_only":
      return capYoungSkaterGp(ewmaGpFromProfile(profile, false), profile);
    case "lag1_ewma_blend":
      return capYoungSkaterGp(
        lag1EwmaGpFromProfile(profile, false, lag1EwmaBlend),
        profile,
      );
    case "injury_only":
      return capYoungSkaterGp(clampGp(injuryGp), profile);
    case "ml_only":
      return capYoungSkaterGp(
        mlGp != null && mlGp > 0 ? clampGp(mlGp) : clampGp(injuryGp),
        profile,
      );
    case "blend_55_45":
      return capYoungSkaterGp(
        mlGp != null && mlGp > 0
          ? clampGp(injuryGp * 0.55 + mlGp * 0.45)
          : clampGp(injuryGp),
        profile,
      );
    case "blend_45_55":
    default:
      return capYoungSkaterGp(
        mlGp != null && mlGp > 0
          ? clampGp(injuryGp * 0.45 + mlGp * 0.55)
          : clampGp(injuryGp),
        profile,
      );
  }
}

export function predictGoalieGpFromStrategy(
  strategy: GoalieGpStrategyType,
  profile: PlayerProfile,
  mlGp: number | null | undefined,
  lag1EwmaBlend: GpLag1EwmaBlend,
  trendGp: number,
  fixedGp: number,
  ensembleWeights?: GpEnsembleWeights,
  twoStepConfig?: GpTwoStepConfig,
): number {
  if (strategy === "two_step_full_season" && twoStepConfig) {
    return predictTwoStepGpFromProfile(profile, mlGp, twoStepConfig, true, trendGp);
  }
  if (strategy === "ensemble" && ensembleWeights) {
    return ensembleGpFromProfile(profile, true, mlGp, ensembleWeights);
  }
  switch (strategy) {
    case "lag1_only":
      return lag1GpFromProfile(profile, true);
    case "ewma_only":
      return ewmaGpFromProfile(profile, true);
    case "lag1_ewma_blend":
      return lag1EwmaGpFromProfile(profile, true, lag1EwmaBlend);
    case "ml_only":
      return mlGp != null && mlGp > 0 ? clampGp(mlGp) : clampGp(trendGp);
    case "fixed_role":
      return clampGp(fixedGp);
    case "trend_based":
    default:
      return clampGp(trendGp);
  }
}
