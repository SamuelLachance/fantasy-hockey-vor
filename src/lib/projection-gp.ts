import type { PlayerProfile } from "./profile-types";

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
  return roleMap?.get(profile.id) ?? (lastSeasonGoalieGp(profile) >= 35 ? "starter" : "backup");
}
