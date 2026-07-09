import type { PlayerProfile } from "../profile-types";
import { priorNhlSeasons } from "./features";
import type { PlayerSeasonRow } from "./types";

export interface TeamDepthContext {
  /** 1 = top scorer at position bucket on team */
  depthRank: number;
  positionDepth: number;
  veteransAhead: number;
  /** 0–1: higher = more opportunity */
  opportunityScore: number;
}

let trainingDepthBySeason: Map<number, Map<number, TeamDepthContext>> | null =
  null;
let inferenceDepthByPlayer: Map<number, TeamDepthContext> | null = null;

export function setTrainingTeamDepthCache(
  cache: Map<number, Map<number, TeamDepthContext>>,
): void {
  trainingDepthBySeason = cache;
}

export function setInferenceTeamDepthCache(
  cache: Map<number, TeamDepthContext>,
): void {
  inferenceDepthByPlayer = cache;
}

export function lookupTeamDepth(
  seasonId: number,
  playerId: number,
): TeamDepthContext | undefined {
  return (
    trainingDepthBySeason?.get(seasonId)?.get(playerId) ??
    inferenceDepthByPlayer?.get(playerId)
  );
}

export function prevSeasonId(seasonId: number): number {
  return seasonId - 10001;
}

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

function positionBucket(position: string): string {
  if (position === "D") return "D";
  if (position === "C") return "C";
  if (position === "LW" || position === "RW") return "W";
  return "F";
}

function skaterStrengthFromPrior(
  prior: PlayerSeasonRow[],
  draftOverall: number,
): number {
  const last = prior.filter((r) => r.gamesPlayed >= 10).at(-1);
  if (last) {
    const pts =
      (last.points ?? last.goals + last.assists) / Math.max(1, last.gamesPlayed);
    const toi = (last.toiPerGame ?? 14) / 20;
    return pts * 1.2 + toi * 0.4;
  }
  if (draftOverall > 0 && draftOverall <= 224) {
    return Math.max(0.15, 1.8 - draftOverall / 120);
  }
  return 0.35;
}

function skaterStrengthFromProfile(profile: PlayerProfile): number {
  const skaterSeasons = profile.teamHistory.filter(
    (s) => !s.isGoalie && s.gamesPlayed >= 10,
  );
  const last = skaterSeasons.at(-1);
  if (last) {
    const pts =
      (last.stats.points ?? last.stats.goals + last.stats.assists) /
      last.gamesPlayed;
    const toi = (last.stats.toiPerGame ?? 14) / 20;
    return pts * 1.2 + toi * 0.4;
  }
  const draft = profile.draft?.overallPick ?? 0;
  if (draft > 0) return Math.max(0.15, 1.8 - draft / 120);
  return 0.35;
}

function goalieStrengthFromPrior(prior: PlayerSeasonRow[]): number {
  const last = prior.filter((r) => r.isGoalie && r.gamesPlayed >= 5).at(-1);
  if (!last) return 0.35;
  const sv = last.savePct > 1 ? last.savePct / 100 : last.savePct;
  const winRate = last.wins / Math.max(1, last.gamesPlayed);
  const gpShare = last.gamesPlayed / 82;
  return sv * 0.5 + winRate * 0.25 + gpShare * 0.25;
}

function goalieStrengthFromProfile(profile: PlayerProfile): number {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie && s.gamesPlayed >= 5);
  const last = seasons.at(-1);
  if (!last) return 0.35;
  const sv =
    last.stats.savePct > 1 ? last.stats.savePct / 100 : (last.stats.savePct ?? 0.905);
  const winRate = (last.stats.wins ?? 0) / last.gamesPlayed;
  const gpShare = last.gamesPlayed / 82;
  return sv * 0.5 + winRate * 0.25 + gpShare * 0.25;
}

function assignDepthRanks(
  list: { playerId: number; strength: number; veteran: boolean }[],
): Map<number, TeamDepthContext> {
  const sorted = [...list].sort((a, b) => b.strength - a.strength);
  const result = new Map<number, TeamDepthContext>();
  const n = sorted.length;
  for (let i = 0; i < n; i++) {
    const { playerId, veteran } = sorted[i];
    const rank = i + 1;
    let veteransAhead = 0;
    for (let j = 0; j < i; j++) {
      if (sorted[j].veteran) veteransAhead++;
    }
    result.set(playerId, {
      depthRank: rank,
      positionDepth: n,
      veteransAhead,
      opportunityScore: Math.max(
        0,
        Math.min(1, 1 - (rank - 1) / Math.max(1, n - 1)),
      ),
    });
  }
  return result;
}

/**
 * Depth entering `targetSeasonId`, built strictly from the previous season's
 * roster — the target season's actual roster is future information during
 * training. Players without a prior season (rookies) get no depth entry and
 * fall back to neutral multipliers.
 */
export function buildTeamDepthFromRows(
  rows: PlayerSeasonRow[],
  historyMap: Map<number, PlayerSeasonRow[]>,
  targetSeasonId: number,
): Map<number, TeamDepthContext> {
  const refSeason = prevSeasonId(targetSeasonId);
  const refRows = rows.filter(
    (r) => !r.isGoalie && r.seasonId === refSeason && r.gamesPlayed >= 10,
  );

  const byTeamPos = new Map<
    string,
    { playerId: number; strength: number; veteran: boolean }[]
  >();
  const seen = new Set<number>();

  for (const row of refRows) {
    if (seen.has(row.playerId)) continue;
    seen.add(row.playerId);
    const team = primaryTeam(row.team);
    const bucket = positionBucket(row.position);
    const key = `${team}:${bucket}`;
    const prior =
      historyMap.get(row.playerId)?.filter((r) => r.seasonId < targetSeasonId) ??
      [];
    const list = byTeamPos.get(key) ?? [];
    list.push({
      playerId: row.playerId,
      strength: skaterStrengthFromPrior(prior, row.draftOverallPick ?? 0),
      veteran: priorNhlSeasons(prior) >= 3,
    });
    byTeamPos.set(key, list);
  }

  const result = new Map<number, TeamDepthContext>();
  for (const list of byTeamPos.values()) {
    for (const [playerId, ctx] of assignDepthRanks(list)) {
      result.set(playerId, ctx);
    }
  }

  const refGoalies = rows.filter(
    (r) => r.isGoalie && r.seasonId === refSeason && r.gamesPlayed >= 5,
  );
  const byTeamG = new Map<
    string,
    { playerId: number; strength: number; veteran: boolean }[]
  >();
  const goalieSeen = new Set<number>();
  for (const row of refGoalies) {
    if (goalieSeen.has(row.playerId)) continue;
    goalieSeen.add(row.playerId);
    const team = primaryTeam(row.team);
    const key = `${team}:G`;
    const prior =
      historyMap.get(row.playerId)?.filter((r) => r.seasonId < targetSeasonId) ??
      [];
    const list = byTeamG.get(key) ?? [];
    list.push({
      playerId: row.playerId,
      strength: goalieStrengthFromPrior(prior),
      veteran: prior.filter((r) => r.isGoalie && r.gamesPlayed >= 10).length >= 3,
    });
    byTeamG.set(key, list);
  }
  for (const list of byTeamG.values()) {
    for (const [playerId, ctx] of assignDepthRanks(list)) {
      result.set(playerId, ctx);
    }
  }

  return result;
}

export function buildTeamDepthFromProfiles(
  profiles: PlayerProfile[],
): Map<number, TeamDepthContext> {
  const skaters = profiles.filter((p) => !p.isGoalie && p.isActive);
  const byTeamPos = new Map<
    string,
    { playerId: number; strength: number; veteran: boolean }[]
  >();

  for (const profile of skaters) {
    const team = primaryTeam(profile.team);
    const pos = profile.positions[0] ?? profile.position;
    const bucket = positionBucket(pos);
    const key = `${team}:${bucket}`;
    const nhlSeasons = profile.teamHistory.filter(
      (s) => !s.isGoalie && s.gamesPlayed >= 10,
    ).length;
    const list = byTeamPos.get(key) ?? [];
    list.push({
      playerId: profile.id,
      strength: skaterStrengthFromProfile(profile),
      veteran: nhlSeasons >= 3,
    });
    byTeamPos.set(key, list);
  }

  const result = new Map<number, TeamDepthContext>();
  for (const list of byTeamPos.values()) {
    for (const [playerId, ctx] of assignDepthRanks(list)) {
      result.set(playerId, ctx);
    }
  }

  const goalies = profiles.filter((p) => p.isGoalie && p.isActive);
  const byTeamG = new Map<
    string,
    { playerId: number; strength: number; veteran: boolean }[]
  >();
  for (const profile of goalies) {
    const team = primaryTeam(profile.team);
    const key = `${team}:G`;
    const nhlSeasons = profile.teamHistory.filter(
      (s) => s.isGoalie && s.gamesPlayed >= 10,
    ).length;
    const list = byTeamG.get(key) ?? [];
    list.push({
      playerId: profile.id,
      strength: goalieStrengthFromProfile(profile),
      veteran: nhlSeasons >= 3,
    });
    byTeamG.set(key, list);
  }
  for (const list of byTeamG.values()) {
    for (const [playerId, ctx] of assignDepthRanks(list)) {
      result.set(playerId, ctx);
    }
  }

  return result;
}

const OPPORTUNITY_TARGETS = new Set([
  "goals",
  "assists",
  "shots",
  "powerplayPoints",
]);

/** Scale young-player rates by draft pedigree, age, and depth-chart opportunity. */
export function depthOpportunityMult(
  depth: TeamDepthContext | undefined,
  draftOverall: number,
  age: number,
  target: string,
): number {
  if (!depth || !OPPORTUNITY_TARGETS.has(target)) {
    return 1;
  }

  let m = 0.9 + depth.opportunityScore * 0.18;

  if (depth.depthRank === 1 && depth.veteransAhead === 0) m *= 1.1;
  else if (depth.depthRank === 1) m *= 1.06;
  else if (depth.depthRank === 2 && depth.veteransAhead <= 1) m *= 1.03;
  else if (depth.depthRank >= 4 || depth.veteransAhead >= 3) m *= 0.88;
  else if (depth.depthRank === 3 && depth.veteransAhead >= 2) m *= 0.93;

  const draft = draftOverall > 0 ? draftOverall : 200;
  if (draft <= 15 && age <= 23 && depth.depthRank <= 2) m *= 1.05;
  if (draft <= 32 && age <= 22 && depth.depthRank <= 3) m *= 1.03;
  if (draft >= 100 && depth.depthRank >= 3) m *= 0.94;

  return Math.max(0.78, Math.min(1.22, m));
}

/** Team depth prior for goalie GP — starter vs tandem vs third-string. */
export function goalieGpPriorFromDepth(
  depth: TeamDepthContext | undefined,
  lastGp: number,
): number {
  if (!depth) {
    return lastGp >= 35 ? 58 : 22;
  }
  if (depth.depthRank === 1) {
    return Math.max(50, Math.min(65, Math.round(lastGp * 0.95)));
  }
  if (depth.depthRank === 2) {
    return Math.max(18, Math.min(32, Math.round(lastGp * 0.5 + 10)));
  }
  return Math.max(8, Math.min(16, Math.round(lastGp * 0.2 + 6)));
}
