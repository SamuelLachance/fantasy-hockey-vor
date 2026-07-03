import type { PlayerProfile, SeasonHistory } from "./profile-types";
import { rookieGoalieProjection } from "./projections";
import type { GoalieProjection, Position, SkaterProjection } from "./types";

const MIN_SEASON_GP = 10;
const SEASON_WEIGHTS = [0.15, 0.3, 0.55];
const LEAGUE_GOALIE_RATES = {
  winRate: 0.45,
  shutoutRate: 0.04,
  savesPerGame: 26,
  savePct: 0.905,
};

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function normalizeSavePct(raw: unknown): number {
  const value = finite(raw, 0.905);
  if (value <= 0) return 0.905;
  return value > 1 ? value / 100 : value;
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
  if (eligible.length === 0) return 0;

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
  if (eligible.length === 0) return LEAGUE_GOALIE_RATES.savePct;

  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const pct = recent.reduce(
    (sum, season, i) =>
      sum +
      normalizeSavePct(season.stats.savePct) * (weights[i] / totalWeight),
    0,
  );
  return Math.max(0.875, Math.min(0.93, pct));
}

function careerGoalieRates(profile: PlayerProfile) {
  const career = profile.careerTotals;
  const gp = finite(career.gamesPlayed);
  if (gp < MIN_SEASON_GP) return null;

  const saves = finite(career.saves ?? career.shotsAgainst);
  return {
    winRate: perGame(finite(career.wins), gp),
    shutoutRate: perGame(finite(career.shutouts), gp),
    saveRate: perGame(saves, gp),
    savePct: normalizeSavePct(career.savePctg ?? career.savePct),
  };
}

function clampGoalieProjection(
  projection: GoalieProjection,
  gamesPlayed: number,
): GoalieProjection {
  const gp = Math.max(1, gamesPlayed);
  const wins = Math.min(Math.max(0, Math.round(projection.wins)), gp);
  const shutouts = Math.min(Math.max(0, Math.round(projection.shutouts)), wins);
  const saves = Math.min(
    Math.max(shutouts * 15, Math.round(projection.saves)),
    gp * 40,
  );

  return {
    wins,
    shutouts,
    saves,
    savePct: Math.max(0.875, Math.min(0.93, projection.savePct)),
  };
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
  const teamBoost = 0.85 + teamWinPct * 0.3;

  const eligibleGp = seasons
    .filter((s) => s.gamesPlayed >= MIN_SEASON_GP)
    .reduce((sum, s) => sum + s.gamesPlayed, 0);

  let winRate = weightedPerGameRate(seasons, (s) => finite(s.stats.wins));
  let shutoutRate = weightedPerGameRate(seasons, (s) => finite(s.stats.shutouts));
  let saveRate = weightedPerGameRate(seasons, (s) => finite(s.stats.saves));
  let savePct = weightedSavePct(seasons);
  let source = "recent seasons";

  if (eligibleGp < MIN_SEASON_GP) {
    const career = careerGoalieRates(profile);
    if (career) {
      winRate = career.winRate;
      shutoutRate = career.shutoutRate;
      saveRate = career.saveRate;
      savePct = career.savePct;
      source = "career totals";
    } else {
      const baseline = rookieGoalieProjection();
      const baselineGp = 55;
      winRate = baseline.wins / baselineGp;
      shutoutRate = baseline.shutouts / baselineGp;
      saveRate = baseline.saves / baselineGp;
      savePct = baseline.savePct;
      source = "league baseline";
    }
  }

  if (winRate <= 0) winRate = LEAGUE_GOALIE_RATES.winRate * teamBoost;
  if (shutoutRate <= 0) shutoutRate = LEAGUE_GOALIE_RATES.shutoutRate;
  if (saveRate <= 0) saveRate = LEAGUE_GOALIE_RATES.savesPerGame;

  const projection = clampGoalieProjection(
    {
      wins: Math.round(winRate * gamesPlayed * ageMult * teamBoost),
      shutouts: Math.round(shutoutRate * gamesPlayed * ageMult),
      saves: Math.round(saveRate * gamesPlayed * Math.max(durability, 0.5)),
      savePct: Math.round(savePct * 10000) / 10000,
    },
    gamesPlayed,
  );

  const reasoning = [
    `Rates from ${source}`,
    `Team win context ${teamBoost.toFixed(2)}`,
    `Age ${profile.bio.age}`,
    `Durability ${durability} → ${gamesPlayed} GP`,
    profile.injury.note,
  ].join("; ");

  return { projection, gamesPlayed, reasoning };
}
