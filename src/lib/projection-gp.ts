import type { PlayerProfile } from "./profile-types";
import { goalieGpPriorFromDepth, lookupTeamDepth } from "./ml/team-depth";
import type {
  GoalieGpStrategyType,
  GpLag1EwmaBlend,
  GpTwoStepConfig,
  SkaterGpStrategyType,
} from "./ml/types";
import {
  DEFAULT_GP_LAG1_EWMA,
  injuryGpFromProfile,
  predictGoalieGpFromStrategy,
  predictSkaterGpFromStrategy,
} from "./ml/gp-predict";

const FULL_SEASON = 82;
export const GOALIE_STARTER_GP = 60;
export const GOALIE_BACKUP_GP = 22;

export type GoalieRole = "starter" | "backup";

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

/** Most recent season GP (goalie seasons only). */
export function lastSeasonGoalieGp(profile: PlayerProfile): number {
  const goalieSeasons = profile.teamHistory.filter(
    (s) => s.isGoalie && s.gamesPlayed > 0,
  );
  const last = goalieSeasons[goalieSeasons.length - 1];
  return last?.gamesPlayed ?? profile.injury.gamesPlayedLastSeason ?? 0;
}

/** Per team: highest last-season GP = starter, all others = backup. */
export function buildGoalieRoleMap(
  profiles: PlayerProfile[],
): Map<number, GoalieRole> {
  const byTeam = new Map<string, PlayerProfile[]>();

  for (const profile of profiles) {
    if (!profile.isGoalie) continue;
    const team = primaryTeam(profile.team);
    const list = byTeam.get(team) ?? [];
    list.push(profile);
    byTeam.set(team, list);
  }

  const roles = new Map<number, GoalieRole>();

  for (const goalies of byTeam.values()) {
    if (goalies.length === 1) {
      roles.set(goalies[0].id, "starter");
      continue;
    }

    const sorted = [...goalies].sort((a, b) => {
      const gpDiff = lastSeasonGoalieGp(b) - lastSeasonGoalieGp(a);
      if (gpDiff !== 0) return gpDiff;
      const aGs = a.teamHistory.filter((s) => s.isGoalie).at(-1)?.stats.gamesStarted ?? 0;
      const bGs = b.teamHistory.filter((s) => s.isGoalie).at(-1)?.stats.gamesStarted ?? 0;
      return bGs - aGs;
    });
    roles.set(sorted[0].id, "starter");
    for (let i = 1; i < sorted.length; i++) {
      roles.set(sorted[i].id, "backup");
    }
  }

  return roles;
}

/** Fixed GP baseline — not predicted from durability or injury history. */
export function projectedGoalieGames(
  profile: PlayerProfile,
  roleMap?: Map<number, GoalieRole>,
): number {
  const role = roleMap?.get(profile.id);
  if (role === "starter") return GOALIE_STARTER_GP;
  if (role === "backup") return GOALIE_BACKUP_GP;

  const lastSeasonGp = lastSeasonGoalieGp(profile);
  return lastSeasonGp >= 35 ? GOALIE_STARTER_GP : GOALIE_BACKUP_GP;
}

function goalieAgeMult(age: number): number {
  if (age >= 37) return 0.82;
  if (age >= 34) return 0.9;
  if (age <= 25) return 1.03;
  return 1;
}

/** Trend-based goalie GP from last-season workload, role, age, and durability. */
export function projectedGoalieGamesTrend(
  profile: PlayerProfile,
  roleMap?: Map<number, GoalieRole>,
): number {
  const role = goalieRoleLabel(profile, roleMap);
  const lastGp = lastSeasonGoalieGp(profile);
  const age = profile.bio.age;
  const durability = profile.injury.durabilityScore;

  let gp = lastGp * goalieAgeMult(age) * (0.85 + 0.15 * durability);

  if (profile.injury.trend === "injury_prone") {
    gp *= 0.94;
  } else if (profile.injury.trend === "healthy" && durability >= 0.9) {
    gp *= 1.02;
  }

  if (role === "starter") {
    const starterFloor = Math.max(55, Math.min(60, lastGp * 0.92));
    const starterCeil = Math.min(65, Math.max(62, lastGp * 1.05));
    gp = Math.max(starterFloor, Math.min(starterCeil, gp));
  } else {
    const backupShare = lastGp > 0 ? Math.min(0.42, 22 / Math.max(lastGp, 35)) : 0.32;
    gp = Math.max(15, Math.min(28, lastGp * backupShare + 8));
  }

  const depth = lookupTeamDepth(0, profile.id);
  const depthPrior = goalieGpPriorFromDepth(depth, lastGp);
  gp = gp * 0.6 + depthPrior * 0.4;

  return Math.max(10, Math.min(FULL_SEASON, Math.round(gp)));
}

/** Skater GP from champion strategy (persistence / injury / ML). */
export function projectedSkaterGames(
  profile: PlayerProfile,
  mlGp?: number | null,
  strategy: SkaterGpStrategyType = "ensemble",
  lag1EwmaBlend: GpLag1EwmaBlend = DEFAULT_GP_LAG1_EWMA,
  ensembleWeights?: import("./ml/types").GpEnsembleWeights,
  twoStepConfig?: GpTwoStepConfig,
): number {
  return predictSkaterGpFromStrategy(
    strategy,
    profile,
    mlGp,
    lag1EwmaBlend,
    injuryGpFromProfile(profile),
    ensembleWeights,
    twoStepConfig,
  );
}

export function projectedGoalieGamesWithStrategy(
  profile: PlayerProfile,
  roleMap: Map<number, GoalieRole> | undefined,
  mlGp: number | null | undefined,
  strategy: GoalieGpStrategyType = "ensemble",
  lag1EwmaBlend: GpLag1EwmaBlend = DEFAULT_GP_LAG1_EWMA,
  ensembleWeights?: import("./ml/types").GpEnsembleWeights,
  twoStepConfig?: GpTwoStepConfig,
  teamGoalies?: PlayerProfile[],
): number {
  return predictGoalieGpFromStrategy(
    strategy,
    profile,
    mlGp,
    lag1EwmaBlend,
    projectedGoalieGamesTrend(profile, roleMap),
    projectedGoalieGames(profile, roleMap),
    ensembleWeights,
    twoStepConfig,
    teamGoalies,
  );
}

/** Skaters use injury/ML GP; goalies use role/trend baselines. */
export function projectedGamesFromProfile(
  profile: PlayerProfile,
  goalieRoleMap?: Map<number, GoalieRole>,
  skaterMlGp?: number | null,
  options?: {
    skaterGpStrategy?: SkaterGpStrategyType;
    skaterGpLag1EwmaBlend?: GpLag1EwmaBlend;
    skaterGpEnsembleWeights?: import("./ml/types").GpEnsembleWeights;
    skaterGpTwoStepConfig?: GpTwoStepConfig;
    goalieGpStrategy?: GoalieGpStrategyType;
    goalieGpLag1EwmaBlend?: GpLag1EwmaBlend;
    goalieGpEnsembleWeights?: import("./ml/types").GpEnsembleWeights;
    goalieGpTwoStepConfig?: GpTwoStepConfig;
    goalieMlGp?: number | null;
    teamGoalies?: PlayerProfile[];
  },
): number {
  if (profile.isGoalie) {
    return projectedGoalieGamesWithStrategy(
      profile,
      goalieRoleMap,
      options?.goalieMlGp,
      options?.goalieGpStrategy ?? "ensemble",
      options?.goalieGpLag1EwmaBlend ?? DEFAULT_GP_LAG1_EWMA,
      options?.goalieGpEnsembleWeights,
      options?.goalieGpTwoStepConfig,
      options?.teamGoalies,
    );
  }
  return projectedSkaterGames(
    profile,
    skaterMlGp,
    options?.skaterGpStrategy ?? "ensemble",
    options?.skaterGpLag1EwmaBlend ?? DEFAULT_GP_LAG1_EWMA,
    options?.skaterGpEnsembleWeights,
    options?.skaterGpTwoStepConfig,
  );
}

export function goalieRoleLabel(
  profile: PlayerProfile,
  roleMap?: Map<number, GoalieRole>,
): GoalieRole {
  return roleMap?.get(profile.id) ?? (lastSeasonGoalieGp(profile) >= 35 ? "starter" : "backup");
}
