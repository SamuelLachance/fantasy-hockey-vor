import type { PlayerProfile } from "../profile-types";
import type { TrainingExample } from "./features";
import { lookupTeamDepth, type TeamDepthContext } from "./team-depth";
import type { PlayerSeasonRow } from "./types";

const FULL_SEASON = 82;

export interface GoalieAllocatorInput {
  playerId: number;
  lastGp: number;
  strength: number;
  depthRank: number;
}

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

function goalieStrengthFromPrior(prior: PlayerSeasonRow[]): number {
  const last = prior.filter((r) => r.isGoalie && r.gamesPlayed >= 5).at(-1);
  if (!last) return 0.35;
  const sv = last.savePct > 1 ? last.savePct / 100 : last.savePct;
  const winRate = last.wins / Math.max(1, last.gamesPlayed);
  const gpShare = last.gamesPlayed / 82;
  return sv * 0.5 + winRate * 0.25 + gpShare * 0.25;
}

/** Softmax-style split of team goalie GP pool across tandem. */
export function allocateGoalieGpShares(
  goalies: GoalieAllocatorInput[],
): Map<number, number> {
  if (goalies.length === 0) return new Map();
  if (goalies.length === 1) {
    const g = goalies[0];
    const gp =
      g.depthRank === 1
        ? Math.max(45, Math.min(65, Math.round(g.lastGp * 0.92 + 4)))
        : Math.max(10, Math.min(30, Math.round(g.lastGp * 0.42 + 8)));
    return new Map([[g.playerId, gp]]);
  }

  const totalLastGp = goalies.reduce((s, g) => s + g.lastGp, 0);
  const raw = goalies.map((g) => {
    const gpShare = totalLastGp > 0 ? g.lastGp / totalLastGp : 1 / goalies.length;
    const depthW = g.depthRank === 1 ? 1.0 : g.depthRank === 2 ? 0.42 : 0.12;
    return Math.max(0.04, gpShare * 0.5 + depthW * g.strength * 0.5);
  });
  const wSum = raw.reduce((a, b) => a + b, 0);
  const pool = Math.min(82, 64 + (goalies.length - 1) * 10);
  return new Map(
    goalies.map((g, i) => [
      g.playerId,
      Math.max(5, Math.min(70, Math.round((pool * raw[i]) / wSum))),
    ]),
  );
}

/** Training: allocate GP for all goalies on each team in a target season. */
export function goalieTeamGpAllocation(
  rows: PlayerSeasonRow[],
  seasonId: number,
  historyMap: Map<number, PlayerSeasonRow[]>,
  depthByPlayer: Map<number, TeamDepthContext>,
): Map<number, number> {
  const seasonGoalies = rows.filter(
    (r) => r.isGoalie && r.seasonId === seasonId && r.gamesPlayed >= 5,
  );
  const byTeam = new Map<string, PlayerSeasonRow[]>();
  for (const row of seasonGoalies) {
    const team = primaryTeam(row.team);
    const list = byTeam.get(team) ?? [];
    list.push(row);
    byTeam.set(team, list);
  }

  const result = new Map<number, number>();
  for (const teamGoalies of byTeam.values()) {
    const inputs: GoalieAllocatorInput[] = teamGoalies.map((row) => {
      const prior =
        historyMap.get(row.playerId)?.filter((r) => r.seasonId < seasonId) ?? [];
      // No prior season → 0, matching allocateGoalieGpFromProfiles. Falling
      // back to row.gamesPlayed would leak the target season's outcome into
      // the training allocation and starter inference.
      const lastGp = prior.at(-1)?.gamesPlayed ?? 0;
      const depth = depthByPlayer.get(row.playerId);
      return {
        playerId: row.playerId,
        lastGp,
        strength: goalieStrengthFromPrior(prior),
        depthRank: depth?.depthRank ?? (lastGp >= 35 ? 1 : 2),
      };
    });
    for (const [id, gp] of allocateGoalieGpShares(inputs)) {
      result.set(id, gp);
    }
  }
  return result;
}

const seasonAllocCache = new Map<number, Map<number, number>>();

export function clearGoalieAllocationCache(): void {
  seasonAllocCache.clear();
}

export function goalieGpFromTeamAllocation(
  ex: TrainingExample,
  prior: PlayerSeasonRow[],
  rows: PlayerSeasonRow[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  depthByPlayer: Map<number, TeamDepthContext>,
): number {
  let alloc = seasonAllocCache.get(ex.seasonId);
  if (!alloc) {
    alloc = goalieTeamGpAllocation(
      rows,
      ex.seasonId,
      historyMap,
      depthByPlayer,
    );
    seasonAllocCache.set(ex.seasonId, alloc);
  }
  return alloc.get(ex.playerId) ?? prior.at(-1)?.gamesPlayed ?? 40;
}

/** Inference: allocate from active goalie profiles on the same team. */
export function allocateGoalieGpFromProfiles(
  profile: PlayerProfile,
  teamGoalies: PlayerProfile[],
): number {
  const team = primaryTeam(profile.team);
  const peers = teamGoalies.filter(
    (p) => p.isGoalie && primaryTeam(p.team) === team,
  );
  const inputs: GoalieAllocatorInput[] = peers.map((p) => {
    const seasons = p.teamHistory.filter((s) => s.isGoalie && s.gamesPlayed >= 5);
    const lastGp = seasons.at(-1)?.gamesPlayed ?? 0;
    const last = seasons.at(-1);
    const sv =
      last && last.stats.savePct
        ? last.stats.savePct > 1
          ? last.stats.savePct / 100
          : last.stats.savePct
        : 0.905;
    const winRate = last ? (last.stats.wins ?? 0) / last.gamesPlayed : 0;
    const depth = lookupTeamDepth(0, p.id);
    return {
      playerId: p.id,
      lastGp,
      strength: sv * 0.5 + winRate * 0.25 + (lastGp / 82) * 0.25,
      depthRank: depth?.depthRank ?? (lastGp >= 35 ? 1 : 2),
    };
  });
  const alloc = allocateGoalieGpShares(inputs);
  return Math.max(10, Math.min(FULL_SEASON, alloc.get(profile.id) ?? 40));
}
