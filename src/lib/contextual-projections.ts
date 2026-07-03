import type { PlayerProfile, SeasonHistory } from "./profile-types";
import type { GoalieProjection, Position, SkaterProjection } from "./types";

const MIN_SEASON_GP = 10;
const SEASON_WEIGHTS = [0.15, 0.3, 0.55];

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function perGame(total: number, gp: number): number {
  return gp > 0 ? total / gp : 0;
}

function trendMultiplier(current: number, prior: number): number {
  if (prior <= 0) return 1;
  const change = (current - prior) / prior;
  return Math.max(0.85, Math.min(1.15, 1 + change * 0.35));
}

function weightedPerGameRate(
  seasons: SeasonHistory[],
  totalFn: (season: SeasonHistory) => number,
): number {
  const eligible = seasons.filter((s) => s.gamesPlayed >= MIN_SEASON_GP);
  if (eligible.length === 0) {
    const fallback = seasons[seasons.length - 1];
    if (!fallback || fallback.gamesPlayed <= 0) return 0;
    return perGame(totalFn(fallback), fallback.gamesPlayed);
  }

  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return recent.reduce((sum, season, i) => {
    const rate = perGame(totalFn(season), season.gamesPlayed);
    return sum + rate * (weights[i] / totalWeight);
  }, 0);
}

function weightedSavePct(seasons: SeasonHistory[]): number {
  const eligible = seasons.filter(
    (s) => s.isGoalie && s.gamesPlayed >= MIN_SEASON_GP,
  );
  if (eligible.length === 0) return 0.905;

  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pct = recent.reduce(
    (sum, season, i) =>
      sum + finite(season.stats.savePct, 0.905) * (weights[i] / totalWeight),
    0,
  );
  return Math.max(0.88, Math.min(0.94, pct));
}

function teamOffenseMultiplier(profile: PlayerProfile): number {
  const lgAvgGf = 2.85;
  const base = profile.teamContext.goalsForPerGame / lgAvgGf;
  const form =
    profile.teamContext.l10GoalsFor /
    Math.max(1, profile.teamContext.l10GoalsFor + profile.teamContext.l10GoalsAgainst);
  return Math.max(0.75, Math.min(1.25, base * 0.7 + form * 0.6));
}

function draftPedigreeMultiplier(profile: PlayerProfile): number {
  if (!profile.draft) return 0.95;
  if (profile.draft.overallPick <= 15 && profile.bio.age <= 26) return 1.08;
  if (profile.draft.overallPick <= 50 && profile.bio.age <= 24) return 1.04;
  if (profile.draft.round >= 4) return 0.97;
  return 1;
}

function ageCurve(position: Position, age: number): number {
  if (position === "G") {
    if (age <= 26) return 1.03;
    if (age >= 34) return 0.9;
    if (age >= 37) return 0.82;
    return 1;
  }
  if (position === "D") {
    if (age <= 23) return 1.07;
    if (age <= 27) return 1.02;
    if (age >= 34) return 0.92;
    return 1;
  }
  if (age <= 22) return 1.09;
  if (age <= 26) return 1.04;
  if (age >= 33) return 0.91;
  if (age >= 36) return 0.84;
  return 1;
}

function projectedGames(profile: PlayerProfile): number {
  const base = profile.injury.avgGamesPlayedLast3 || profile.injury.gamesPlayedLastSeason || 55;
  const durability = profile.injury.durabilityScore;
  const stage = profile.contract.careerStage;
  let gp = base * (0.6 + durability * 0.4);
  if (stage === "rookie") gp = Math.min(gp, 70);
  if (profile.isGoalie) return Math.round(Math.min(58, Math.max(20, gp)));
  return Math.round(Math.min(78, Math.max(30, gp)));
}

export function projectSkaterFromProfile(
  profile: PlayerProfile,
): { projection: SkaterProjection; gamesPlayed: number; reasoning: string } {
  const seasons = profile.teamHistory.filter((s) => !s.isGoalie);
  const last = seasons[seasons.length - 1];
  const prev = seasons[seasons.length - 2];
  const gamesPlayed = projectedGames(profile);

  const teamMult = teamOffenseMultiplier(profile);
  const ageMult = ageCurve(profile.position, profile.bio.age);
  const draftMult = draftPedigreeMultiplier(profile);
  const trendMult = last && prev ? trendMultiplier(last.stats.points ?? 0, prev.stats.points ?? 0) : 1;

  const rates = {
    goals: weightedPerGameRate(seasons, (s) => finite(s.stats.goals)),
    assists: weightedPerGameRate(seasons, (s) => finite(s.stats.assists)),
    shots: weightedPerGameRate(seasons, (s) => finite(s.stats.shots)),
    blocks: weightedPerGameRate(seasons, (s) => finite(s.advanced.blocks)),
    hits: weightedPerGameRate(seasons, (s) => finite(s.advanced.hits)),
    powerplayPoints: weightedPerGameRate(seasons, (s) => finite(s.stats.ppPoints)),
    penaltyMinutes: weightedPerGameRate(seasons, (s) => finite(s.stats.pim)),
    faceoffWins: weightedPerGameRate(seasons, (s) => finite(s.advanced.faceoffWins)),
  };

  const usageSeason = seasons.filter((s) => s.gamesPlayed >= MIN_SEASON_GP).slice(-1)[0] ?? last;
  const usageBoost =
    finite(usageSeason?.advanced.satFor60) > 0
      ? Math.min(1.12, 1 + finite(usageSeason?.advanced.satFor60) / 100)
      : 1;

  const mult = teamMult * ageMult * draftMult * trendMult * usageBoost;

  const projection: SkaterProjection = {
    goals: Math.round(rates.goals * gamesPlayed * mult),
    assists: Math.round(rates.assists * gamesPlayed * mult),
    shots: Math.round(rates.shots * gamesPlayed * mult * 1.02),
    blocks: Math.round(rates.blocks * gamesPlayed * (profile.position === "D" ? 1.05 : 1)),
    hits: Math.round(rates.hits * gamesPlayed),
    powerplayPoints: Math.round(rates.powerplayPoints * gamesPlayed * teamMult),
    penaltyMinutes: Math.round(rates.penaltyMinutes * gamesPlayed),
    faceoffWins: Math.round(
      rates.faceoffWins * gamesPlayed * (profile.position === "C" ? 1.05 : 0.3),
    ),
  };

  const reasoning = [
    `Team offense mult ${teamMult.toFixed(2)} (#${profile.teamContext.leagueRank} ${profile.teamContext.teamAbbrev})`,
    `Age ${profile.bio.age} curve ${ageMult.toFixed(2)}`,
    profile.draft ? `Draft #${profile.draft.overallPick} pedigree ${draftMult.toFixed(2)}` : "Undrafted",
    `Durability ${profile.injury.durabilityScore} → ${gamesPlayed} GP`,
    profile.injury.note,
  ].join("; ");

  return { projection, gamesPlayed, reasoning };
}

export function projectGoalieFromProfile(
  profile: PlayerProfile,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie);
  const gamesPlayed = projectedGames(profile);

  const teamWinPct = profile.teamContext.pointsPct;
  const ageMult = ageCurve("G", profile.bio.age);
  const durability = profile.injury.durabilityScore;

  const winRate = weightedPerGameRate(seasons, (s) => finite(s.stats.wins));
  const shutoutRate = weightedPerGameRate(seasons, (s) => finite(s.stats.shutouts));
  const saveRate = weightedPerGameRate(seasons, (s) => finite(s.stats.saves));
  const savePct = weightedSavePct(seasons);

  const teamBoost = 0.85 + teamWinPct * 0.3;

  const projection: GoalieProjection = {
    wins: Math.round(winRate * gamesPlayed * ageMult * teamBoost),
    shutouts: Math.round(shutoutRate * gamesPlayed * ageMult),
    saves: Math.round(saveRate * gamesPlayed * durability),
    savePct: Math.round(savePct * 10000) / 10000,
  };

  const reasoning = [
    `Team win context ${teamBoost.toFixed(2)}`,
    `Age ${profile.bio.age}`,
    `Durability ${durability} → ${gamesPlayed} GP`,
    profile.injury.note,
  ].join("; ");

  return { projection, gamesPlayed, reasoning };
}
