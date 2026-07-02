import type {
  GoalieProjection,
  Position,
  SkaterProjection,
} from "./types";

const PROJECTED_GAMES = 72;
const PROJECTED_GOALIE_GAMES = 55;

const SEASON_WEIGHTS = [0.15, 0.3, 0.55];

export interface SeasonSkaterRates {
  goals: number;
  assists: number;
  shots: number;
  blocks: number;
  hits: number;
  powerplayPoints: number;
  penaltyMinutes: number;
  faceoffWins: number;
  gamesPlayed: number;
}

export interface SeasonGoalieRates {
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
  gamesPlayed: number;
}

function finite(n: number, fallback = 0): number {
  return Number.isFinite(n) ? n : fallback;
}

function perGame(total: number, games: number): number {
  return games > 0 ? finite(total) / games : 0;
}

function weightedRate(
  rates: number[],
  weights: number[] = SEASON_WEIGHTS,
): number {
  const available = rates.filter((r) => r > 0);
  if (available.length === 0) return 0;
  if (available.length === 1) return available[0];

  const w = weights.slice(-available.length);
  const totalWeight = w.reduce((a, b) => a + b, 0);
  return available.reduce((sum, rate, i) => sum + rate * (w[i] / totalWeight), 0);
}

function ageFromBirthDate(birthDate?: string): number | null {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date("2026-10-01");
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function skaterAgeMultiplier(age: number | null, position: Position): number {
  if (age == null) return 1;
  if (position === "D") {
    if (age <= 23) return 1.06;
    if (age <= 27) return 1.02;
    if (age >= 34) return 0.94;
    if (age >= 37) return 0.88;
    return 1;
  }
  if (age <= 22) return 1.08;
  if (age <= 26) return 1.03;
  if (age >= 33) return 0.93;
  if (age >= 36) return 0.86;
  return 1;
}

function goalieAgeMultiplier(age: number | null): number {
  if (age == null) return 1;
  if (age <= 25) return 1.04;
  if (age >= 34) return 0.92;
  if (age >= 37) return 0.85;
  return 1;
}

function projectGamesPlayed(seasonGPs: number[]): number {
  const recent = seasonGPs.filter((g) => g > 0);
  if (recent.length === 0) return 40;
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  return Math.min(PROJECTED_GAMES, Math.round(avg * 0.95));
}

export function projectSkater(
  seasons: SeasonSkaterRates[],
  position: Position,
  birthDate?: string,
): { projection: SkaterProjection; gamesPlayed: number } {
  const gamesPlayed = projectGamesPlayed(seasons.map((s) => s.gamesPlayed));
  const age = ageFromBirthDate(birthDate);
  const multiplier = skaterAgeMultiplier(age, position);

  const rates = {
    goals: weightedRate(seasons.map((s) => perGame(s.goals, s.gamesPlayed))),
    assists: weightedRate(
      seasons.map((s) => perGame(s.assists, s.gamesPlayed)),
    ),
    shots: weightedRate(seasons.map((s) => perGame(s.shots, s.gamesPlayed))),
    blocks: weightedRate(seasons.map((s) => perGame(s.blocks, s.gamesPlayed))),
    hits: weightedRate(seasons.map((s) => perGame(s.hits, s.gamesPlayed))),
    powerplayPoints: weightedRate(
      seasons.map((s) => perGame(s.powerplayPoints, s.gamesPlayed)),
    ),
    penaltyMinutes: weightedRate(
      seasons.map((s) => perGame(s.penaltyMinutes, s.gamesPlayed)),
    ),
    faceoffWins: weightedRate(
      seasons.map((s) => perGame(s.faceoffWins, s.gamesPlayed)),
    ),
  };

  const projection: SkaterProjection = {
    goals: Math.round(finite(rates.goals * gamesPlayed * multiplier)),
    assists: Math.round(finite(rates.assists * gamesPlayed * multiplier)),
    shots: Math.round(finite(rates.shots * gamesPlayed * multiplier)),
    blocks: Math.round(finite(rates.blocks * gamesPlayed * multiplier)),
    hits: Math.round(finite(rates.hits * gamesPlayed * multiplier)),
    powerplayPoints: Math.round(
      finite(rates.powerplayPoints * gamesPlayed * multiplier),
    ),
    penaltyMinutes: Math.round(
      finite(rates.penaltyMinutes * gamesPlayed * multiplier),
    ),
    faceoffWins: Math.round(
      finite(rates.faceoffWins * gamesPlayed * multiplier),
    ),
  };

  return { projection, gamesPlayed };
}

export function projectGoalie(
  seasons: SeasonGoalieRates[],
  birthDate?: string,
): { projection: GoalieProjection; gamesPlayed: number } {
  const seasonGPs = seasons.map((s) => s.gamesPlayed);
  const recent = seasonGPs.filter((g) => g > 0);
  const avgGP =
    recent.length > 0
      ? recent.reduce((a, b) => a + b, 0) / recent.length
      : 30;
  const gamesPlayed = Math.min(
    PROJECTED_GOALIE_GAMES,
    Math.round(avgGP * 0.95),
  );
  const age = ageFromBirthDate(birthDate);
  const multiplier = goalieAgeMultiplier(age);

  const winRate = weightedRate(
    seasons.map((s) => perGame(s.wins, s.gamesPlayed)),
  );
  const shutoutRate = weightedRate(
    seasons.map((s) => perGame(s.shutouts, s.gamesPlayed)),
  );
  const saveRate = weightedRate(
    seasons.map((s) => perGame(s.saves, s.gamesPlayed)),
  );
  const savePctRates = seasons
    .filter((s) => s.gamesPlayed >= 10)
    .map((s) => s.savePct);
  const savePct =
    savePctRates.length > 0
      ? weightedRate(savePctRates, savePctRates.map(() => 1 / savePctRates.length))
      : 0.905;

  const projection: GoalieProjection = {
    wins: Math.round(finite(winRate * gamesPlayed * multiplier)),
    shutouts: Math.round(finite(shutoutRate * gamesPlayed * multiplier)),
    saves: Math.round(finite(saveRate * gamesPlayed * multiplier)),
    savePct: Math.round(finite(savePct) * 10000) / 10000,
  };

  return { projection, gamesPlayed };
}

export function rookieSkaterProjection(position: Position): SkaterProjection {
  const baseline: Record<Position, SkaterProjection> = {
    C: {
      goals: 12,
      assists: 18,
      shots: 110,
      blocks: 25,
      hits: 55,
      powerplayPoints: 8,
      penaltyMinutes: 28,
      faceoffWins: 320,
    },
    LW: {
      goals: 14,
      assists: 16,
      shots: 125,
      blocks: 20,
      hits: 60,
      powerplayPoints: 9,
      penaltyMinutes: 24,
      faceoffWins: 8,
    },
    RW: {
      goals: 15,
      assists: 15,
      shots: 130,
      blocks: 20,
      hits: 58,
      powerplayPoints: 9,
      penaltyMinutes: 22,
      faceoffWins: 6,
    },
    D: {
      goals: 6,
      assists: 22,
      shots: 115,
      blocks: 110,
      hits: 75,
      powerplayPoints: 10,
      penaltyMinutes: 32,
      faceoffWins: 0,
    },
    G: {
      goals: 0,
      assists: 0,
      shots: 0,
      blocks: 0,
      hits: 0,
      powerplayPoints: 0,
      penaltyMinutes: 0,
      faceoffWins: 0,
    },
  };
  return baseline[position];
}

export function rookieGoalieProjection(): GoalieProjection {
  return { wins: 18, shutouts: 2, saves: 1450, savePct: 0.905 };
}
