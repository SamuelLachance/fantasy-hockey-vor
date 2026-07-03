import type { PlayerProfile } from "./profile-types";

const FULL_SEASON = 82;
export const GOALIE_STARTER_GP = 60;
export const GOALIE_BACKUP_GP = 22;

export type GoalieRole = "starter" | "backup";

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

function recentGoalieWorkload(profile: PlayerProfile): number {
  const goalieSeasons = profile.teamHistory.filter((s) => s.isGoalie);
  const last = goalieSeasons[goalieSeasons.length - 1];
  return (
    profile.injury.avgGamesPlayedLast3 ||
    profile.injury.gamesPlayedLastSeason ||
    last?.gamesPlayed ||
    0
  );
}

/** Per team: highest recent workload = starter, all others = backup. */
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

    const sorted = [...goalies].sort(
      (a, b) => recentGoalieWorkload(b) - recentGoalieWorkload(a),
    );
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

  const workload = recentGoalieWorkload(profile);
  return workload >= 35 ? GOALIE_STARTER_GP : GOALIE_BACKUP_GP;
}

/** Skaters use full-season GP. Goalies use fixed starter/backup baselines. */
export function projectedGamesFromProfile(
  profile: PlayerProfile,
  goalieRoleMap?: Map<number, GoalieRole>,
): number {
  if (profile.isGoalie) {
    return projectedGoalieGames(profile, goalieRoleMap);
  }
  return FULL_SEASON;
}

export function goalieRoleLabel(
  profile: PlayerProfile,
  roleMap?: Map<number, GoalieRole>,
): GoalieRole {
  return roleMap?.get(profile.id) ?? (recentGoalieWorkload(profile) >= 35 ? "starter" : "backup");
}
