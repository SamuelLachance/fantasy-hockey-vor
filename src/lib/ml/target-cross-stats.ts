import type { SkaterMlTarget } from "./types";

/** Related stat EWMA features (1 per stat) — captures cross-stat correlation cheaply. */
export const TARGET_CROSS_EWMA_STATS: Record<SkaterMlTarget, readonly string[]> = {
  goals: ["shots", "xGoals", "powerplayPoints", "assists"],
  assists: ["goals", "points", "evPoints", "shots"],
  shots: ["goals", "xGoals", "satFor60", "totalShotAttempts"],
  blocks: ["hits", "blockedShotsPer60", "dZoneStartPct"],
  hits: ["blocks", "hitsPer60", "takeaways"],
  powerplayPoints: ["ppGoals", "goals", "ppToiPctPerGame"],
  penaltyMinutes: ["penaltiesTaken", "penaltiesDrawn", "hits", "giveaways", "shToiPerGame"],
  faceoffWins: ["faceoffWinPct", "totalFaceoffs"],
};

export function targetCrossEwmaStats(target: SkaterMlTarget): readonly string[] {
  return TARGET_CROSS_EWMA_STATS[target];
}
