import type { Position } from "./types";
import type { GoalieProjection, SkaterProjection } from "./types";
import type { PlayerProfile } from "./profile-types";

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
    goals: 0.18,
    assists: 1.1,
    shots: 3.5,
    blocks: 3.2,
    hits: 4.5,
    powerplayPoints: 0.45,
    penaltyMinutes: 4.5,
    faceoffWins: 0,
  },
};

const GOALIE_RATE_LIMITS = {
  winRate: 0.62,
  shutoutRate: 0.12,
  savesPerGame: 40,
  savePctMin: 0.86,
  savePctMax: 0.945,
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
  const assists = clampTotal(projection.assists, limits.assists, gp);
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
  const faceoffWins =
    position === "D"
      ? 0
      : clampTotal(projection.faceoffWins, limits.faceoffWins, gp);

  if (powerplayPoints > goals + assists) {
    // Reconcile an inconsistent PPP head with the scoring stats, but never
    // beyond the positional goal-rate cap; the shots floor below then keeps
    // shots >= goals for the bumped value.
    goals = clampTotal(
      Math.max(goals, Math.round(powerplayPoints * 0.45)),
      limits.goals,
      gp,
    );
  }

  const minShots = Math.max(goals, Math.round((goals + assists) * 0.65));
  shots = Math.max(shots, minShots);

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
  // Keep saves and SV% coherent in shot space so SAA VOR is not corrupted.
  const rawSv = Number.isFinite(projection.savePct) ? projection.savePct : 0.905;
  const impliedShots =
    rawSv > 0.5
      ? Math.max(0, projection.saves / rawSv)
      : Math.max(0, projection.saves / 0.905);
  const savePct = Math.max(
    GOALIE_RATE_LIMITS.savePctMin,
    Math.min(GOALIE_RATE_LIMITS.savePctMax, rawSv),
  );
  let saves = Math.round(impliedShots * savePct);
  saves = Math.min(
    Math.max(shutouts * 12, saves),
    Math.round(GOALIE_RATE_LIMITS.savesPerGame * gp),
  );

  return {
    wins,
    shutouts,
    saves,
    savePct,
  };
}

function careerPerGame(
  profile: PlayerProfile,
  stat: keyof PlayerProfile["careerTotals"],
): number {
  const gp = profile.careerTotals.gamesPlayed ?? 0;
  if (gp < 5) return 0;
  const total = Number(profile.careerTotals[stat] ?? 0);
  return total / gp;
}

function maxSeasonPerGame(profile: PlayerProfile, stat: string): number {
  let max = 0;
  for (const s of profile.teamHistory) {
    if (s.isGoalie || s.gamesPlayed < 10) continue;
    const val = Number(s.stats[stat] ?? s.advanced[stat] ?? 0);
    max = Math.max(max, val / s.gamesPlayed);
  }
  return max;
}

function careerStatPerGame(profile: PlayerProfile, stat: string): number {
  const gp = profile.careerTotals.gamesPlayed ?? 0;
  const careerKey = stat === "pim" ? "pim" : stat;
  const careerVal = profile.careerTotals[careerKey];
  if (careerVal != null && gp >= 5) return Number(careerVal) / gp;

  let total = 0;
  let games = 0;
  for (const s of profile.teamHistory) {
    if (s.isGoalie || s.gamesPlayed < 10) continue;
    total += Number(s.stats[careerKey] ?? s.advanced[careerKey] ?? 0);
    games += s.gamesPlayed;
  }
  return games > 0 ? total / games : 0;
}

/** Pull ML/contextual projections back toward provable NHL history (empirical-Bayes style). */
export function anchorSkaterProjectionToHistory(
  profile: PlayerProfile,
  projection: SkaterProjection,
  gamesPlayed: number,
): SkaterProjection {
  const gp = Math.max(1, gamesPlayed);
  const careerGp = profile.careerTotals.gamesPlayed ?? 0;

  const shrink = (
    projected: number,
    stat: string,
    ceilingMult = 1.35,
  ): number => {
    const careerRate = careerStatPerGame(profile, stat);
    const maxRate = maxSeasonPerGame(profile, stat === "pim" ? "pim" : stat);
    if (careerRate <= 0 && maxRate <= 0) return projected;

    const priorRate = Math.max(careerRate, maxRate * 0.85);
    const priorWeight = Math.min(30, Math.max(8, careerGp * 0.25));
    const projectedRate = projected / gp;
    // Empirical Bayes: the projection carries its own gp games of evidence
    // against priorWeight pseudo-games of history.
    const shrunkRate =
      (priorRate * priorWeight + projectedRate * gp) / (priorWeight + gp);
    const ceiling = Math.max(priorRate, maxRate) * gp * ceilingMult;
    return Math.min(Math.round(shrunkRate * gp), Math.round(ceiling));
  };

  let goals = projection.goals;
  let powerplayPoints = projection.powerplayPoints;

  const careerGoals = careerPerGame(profile, "goals");
  const careerPpp = careerPerGame(profile, "powerPlayPoints");
  const maxGoalRate = maxSeasonPerGame(profile, "goals");
  const maxPppRate = maxSeasonPerGame(profile, "ppPoints");

  if (careerGoals <= 0 && maxGoalRate <= 0) {
    goals = profile.position === "D" ? Math.min(goals, 4) : Math.min(goals, 8);
  } else {
    const ceiling = Math.max(careerGoals, maxGoalRate) * gp * 1.35;
    goals = Math.min(goals, Math.round(ceiling));
  }

  if (careerPpp <= 0 && maxPppRate <= 0) {
    powerplayPoints = Math.min(powerplayPoints, Math.round(goals * 0.35));
  } else {
    const pppCeiling = Math.max(careerPpp, maxPppRate) * gp * 1.35;
    powerplayPoints = Math.min(powerplayPoints, Math.round(pppCeiling));
  }

  const blocks = shrink(projection.blocks, "blocks", 1.4);
  const hits = shrink(projection.hits, "hits", 1.4);
  const penaltyMinutes = shrink(projection.penaltyMinutes, "pim", 1.5);

  return clampSkaterProjection(
    { ...projection, goals, powerplayPoints, blocks, hits, penaltyMinutes },
    gamesPlayed,
    profile.position,
  );
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
    if (s.powerplayPoints > s.goals + s.assists + 2) {
      issues.push({ name: player.name, position: player.position, reason: "powerplay points exceed points" });
    }
  }

  return issues;
}
