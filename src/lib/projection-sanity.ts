import type { Position } from "./types";
import type { GoalieProjection, SkaterProjection } from "./types";

interface SkaterRateLimits {
  goals: number;
  assists: number;
  shots: number;
  blocks: number;
  hits: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  faceoffWins: number;
}

const SKATER_RATE_LIMITS: Record<Exclude<Position, "G">, SkaterRateLimits> = {
  C: {
    goals: 1.35,
    assists: 1.65,
    shots: 6.5,
    blocks: 2,
    hits: 5.5,
    powerplayPoints: 1.3,
    penaltyMinutes: 4.5,
    faceoffWins: 18,
  },
  LW: {
    goals: 1.35,
    assists: 1.65,
    shots: 6.5,
    blocks: 1.6,
    hits: 5.5,
    powerplayPoints: 1.3,
    penaltyMinutes: 4.5,
    faceoffWins: 3,
  },
  RW: {
    goals: 1.35,
    assists: 1.65,
    shots: 6.5,
    blocks: 1.6,
    hits: 5.5,
    powerplayPoints: 1.3,
    penaltyMinutes: 4.5,
    faceoffWins: 3,
  },
  D: {
    goals: 0.55,
    assists: 1.4,
    shots: 4.5,
    blocks: 3.2,
    hits: 4.5,
    powerplayPoints: 0.95,
    penaltyMinutes: 4.5,
    faceoffWins: 0.5,
  },
};

const GOALIE_RATE_LIMITS = {
  winRate: 0.62,
  shutoutRate: 0.12,
  savesPerGame: 40,
  savePctMin: 0.865,
  savePctMax: 0.935,
};

function clampTotal(value: number, perGameMax: number, gamesPlayed: number): number {
  const max = Math.floor(perGameMax * Math.max(1, gamesPlayed));
  return Math.min(Math.max(0, Math.round(value)), max);
}

export function clampSkaterProjection(
  projection: SkaterProjection,
  gamesPlayed: number,
  position: Position,
): SkaterProjection {
  if (position === "G") {
    return {
      goals: 0,
      assists: 0,
      shots: 0,
      blocks: 0,
      hits: 0,
      powerplayPoints: 0,
      penaltyMinutes: 0,
      faceoffWins: 0,
    };
  }

  const limits = SKATER_RATE_LIMITS[position];
  const gp = Math.max(1, gamesPlayed);

  let goals = clampTotal(projection.goals, limits.goals, gp);
  let assists = clampTotal(projection.assists, limits.assists, gp);
  let shots = clampTotal(projection.shots, limits.shots, gp);
  const blocks = clampTotal(projection.blocks, limits.blocks, gp);
  const hits = clampTotal(projection.hits, limits.hits, gp);
  const powerplayPoints = clampTotal(
    projection.powerplayPoints,
    limits.powerplayPoints,
    gp,
  );
  const penaltyMinutes = clampTotal(
    projection.penaltyMinutes,
    limits.penaltyMinutes,
    gp,
  );
  const faceoffWins = clampTotal(
    projection.faceoffWins,
    limits.faceoffWins,
    gp,
  );

  const minShots = Math.max(goals, Math.round((goals + assists) * 0.65));
  shots = Math.max(shots, minShots);

  if (powerplayPoints > goals + assists) {
    goals = Math.max(goals, Math.round(powerplayPoints * 0.45));
  }

  return {
    goals,
    assists,
    shots,
    blocks,
    hits,
    powerplayPoints: Math.min(powerplayPoints, goals + assists),
    penaltyMinutes,
    faceoffWins,
  };
}

export function clampGoalieProjection(
  projection: GoalieProjection,
  gamesPlayed: number,
): GoalieProjection {
  const gp = Math.max(1, gamesPlayed);
  const wins = clampTotal(
    projection.wins,
    GOALIE_RATE_LIMITS.winRate,
    gp,
  );
  const shutouts = Math.min(
    clampTotal(projection.shutouts, GOALIE_RATE_LIMITS.shutoutRate, gp),
    wins,
  );
  const saves = Math.min(
    Math.max(shutouts * 12, Math.round(projection.saves)),
    Math.round(GOALIE_RATE_LIMITS.savesPerGame * gp),
  );

  return {
    wins,
    shutouts,
    saves,
    savePct: Math.max(
      GOALIE_RATE_LIMITS.savePctMin,
      Math.min(GOALIE_RATE_LIMITS.savePctMax, projection.savePct),
    ),
  };
}

export interface ProjectionIssue {
  name: string;
  position: Position;
  reason: string;
}

export function findProjectionIssues(
  players: Array<{
    name: string;
    position: Position;
    isGoalie: boolean;
    gamesPlayed: number;
    projection: SkaterProjection | GoalieProjection;
  }>,
): ProjectionIssue[] {
  const issues: ProjectionIssue[] = [];

  for (const player of players) {
    const gp = Math.max(1, player.gamesPlayed);
    const pr = player.projection;

    if (player.isGoalie) {
      const g = pr as GoalieProjection;
      if (g.wins > gp) issues.push({ name: player.name, position: player.position, reason: "wins exceed games played" });
      if (g.shutouts > g.wins) issues.push({ name: player.name, position: player.position, reason: "shutouts exceed wins" });
      if (g.wins / gp > GOALIE_RATE_LIMITS.winRate + 0.001) {
        issues.push({ name: player.name, position: player.position, reason: "win rate too high" });
      }
      if (g.savePct < GOALIE_RATE_LIMITS.savePctMin || g.savePct > GOALIE_RATE_LIMITS.savePctMax) {
        issues.push({ name: player.name, position: player.position, reason: "save percentage out of range" });
      }
      continue;
    }

    const limits = SKATER_RATE_LIMITS[player.position as Exclude<Position, "G">];
    if (!limits) continue;

    const s = pr as SkaterProjection;
    if (s.goals / gp > limits.goals + 0.001) issues.push({ name: player.name, position: player.position, reason: "goals rate too high" });
    if (s.assists / gp > limits.assists + 0.001) issues.push({ name: player.name, position: player.position, reason: "assists rate too high" });
    if (s.shots / gp > limits.shots + 0.001) issues.push({ name: player.name, position: player.position, reason: "shots rate too high" });
    if (s.blocks / gp > limits.blocks + 0.001) issues.push({ name: player.name, position: player.position, reason: "blocks rate too high" });
    if (s.hits / gp > limits.hits + 0.001) issues.push({ name: player.name, position: player.position, reason: "hits rate too high" });
    if (s.shots < s.goals) issues.push({ name: player.name, position: player.position, reason: "shots below goals" });
  }

  return issues;
}
