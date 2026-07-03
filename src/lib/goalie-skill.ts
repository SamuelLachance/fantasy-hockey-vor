import type { PlayerProfile, SeasonHistory } from "./profile-types";

/** League-average even-strength save percentage baseline. */
export const LEAGUE_SV_PCT = 0.905;

/** Prior shot volume for empirical-Bayes shrinkage (Schuckers/Naples literature: ~1500 SA). */
export const EB_PRIOR_SHOTS = 1500;

export const LEAGUE_GA_PER_GAME = 2.85;

const MIN_SEASON_GP = 10;
const SEASON_WEIGHTS = [0.15, 0.3, 0.55];

export interface GoalieSeasonShots {
  gamesPlayed: number;
  saves: number;
  shotsAgainst: number;
  goalsAgainst: number;
  wins: number;
  shutouts: number;
}

export interface ShrunkGoalieSkill {
  savePct: number;
  gsaa: number;
  gsaxProxy: number;
  gsaaPer60: number;
  shotsPerGame: number;
  totalWeightedShots: number;
  winRate: number;
  shutoutRate: number;
  source: string;
}

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export function normalizeSavePct(raw: unknown): number {
  const value = finite(raw, LEAGUE_SV_PCT);
  if (value <= 0) return LEAGUE_SV_PCT;
  return value > 1 ? value / 100 : value;
}

/** Derive shots against from saves and save% when not stored. */
export function deriveShotsAgainst(
  saves: number,
  savePct: unknown,
  stored?: number,
): number {
  if (stored && stored > 0) return stored;
  const sv = normalizeSavePct(savePct);
  if (sv <= 0 || sv >= 1) {
    return saves > 0 ? Math.round(saves / LEAGUE_SV_PCT) : 0;
  }
  return Math.round(saves / sv);
}

export function deriveGoalsAgainst(
  shotsAgainst: number,
  saves: number,
  stored?: number,
): number {
  if (stored != null && stored >= 0) return stored;
  return Math.max(0, shotsAgainst - saves);
}

/** Beta-binomial / conjugate shrinkage of save% toward league (or team-adjusted) mean. */
export function empiricalBayesSavePct(
  saves: number,
  shotsAgainst: number,
  priorMean = LEAGUE_SV_PCT,
  priorShots = EB_PRIOR_SHOTS,
): number {
  if (shotsAgainst <= 0) return priorMean;
  return (saves + priorShots * priorMean) / (shotsAgainst + priorShots);
}

/** Goals saved above average under a uniform league-average shot model. */
export function gsaa(
  saves: number,
  shotsAgainst: number,
  leagueSvPct = LEAGUE_SV_PCT,
): number {
  return saves - leagueSvPct * shotsAgainst;
}

/**
 * Team-adjusted expected goal rate per shot (proxy for shot environment / xG baseline).
 * Weaker team defense → higher expected goals per shot faced.
 */
export function teamAdjustedGoalRatePerShot(
  teamGoalsAgainstPerGame: number,
  leagueGoalsAgainstPerGame = LEAGUE_GA_PER_GAME,
  leagueSvPct = LEAGUE_SV_PCT,
): number {
  const base = 1 - leagueSvPct;
  const factor = Math.max(
    0.85,
    Math.min(1.15, teamGoalsAgainstPerGame / leagueGoalsAgainstPerGame),
  );
  return base * factor;
}

export function teamAdjustedExpectedSv(
  teamGoalsAgainstPerGame: number,
  leagueGoalsAgainstPerGame = LEAGUE_GA_PER_GAME,
  leagueSvPct = LEAGUE_SV_PCT,
): number {
  return 1 - teamAdjustedGoalRatePerShot(
    teamGoalsAgainstPerGame,
    leagueGoalsAgainstPerGame,
    leagueSvPct,
  );
}

/**
 * GSAx proxy: goals saved above team-environment-adjusted expectation.
 * GSAx = xGA − GA = saves − (1 − p_goal_team) × SA
 */
export function gsaxProxy(
  saves: number,
  shotsAgainst: number,
  teamGoalsAgainstPerGame: number,
): number {
  const expectedSv = teamAdjustedExpectedSv(teamGoalsAgainstPerGame);
  return saves - expectedSv * shotsAgainst;
}

export function seasonToShots(season: SeasonHistory): GoalieSeasonShots {
  const saves = finite(season.stats.saves);
  const shotsAgainst = deriveShotsAgainst(
    saves,
    season.stats.savePct,
    finite(season.stats.shotsAgainst) || undefined,
  );
  return {
    gamesPlayed: season.gamesPlayed,
    saves,
    shotsAgainst,
    goalsAgainst: deriveGoalsAgainst(
      shotsAgainst,
      saves,
      season.stats.goalsAgainst,
    ),
    wins: finite(season.stats.wins),
    shutouts: finite(season.stats.shutouts),
  };
}

function weightedRate(
  seasons: GoalieSeasonShots[],
  weights: number[],
  rateFn: (s: GoalieSeasonShots) => number,
): number {
  const totalW = weights.reduce((a, b) => a + b, 0);
  if (totalW <= 0) return 0;
  return seasons.reduce(
    (sum, s, i) => sum + rateFn(s) * (weights[i] / totalW),
    0,
  );
}

export function estimateShrunkGoalieSkill(
  seasons: SeasonHistory[],
  teamGoalsAgainstPerGame: number,
): ShrunkGoalieSkill {
  const eligible = seasons.filter((s) => s.isGoalie && s.gamesPlayed >= MIN_SEASON_GP);
  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);

  if (recent.length === 0) {
    return {
      savePct: LEAGUE_SV_PCT,
      gsaa: 0,
      gsaxProxy: 0,
      gsaaPer60: 0,
      shotsPerGame: 28,
      totalWeightedShots: 0,
      winRate: 0.45,
      shutoutRate: 0.04,
      source: "league prior",
    };
  }

  const shotSeasons = recent.map(seasonToShots);
  let weightedSaves = 0;
  let weightedSa = 0;
  let weightedGp = 0;

  for (let i = 0; i < shotSeasons.length; i++) {
    const w = weights[i];
    weightedSaves += shotSeasons[i].saves * w;
    weightedSa += shotSeasons[i].shotsAgainst * w;
    weightedGp += shotSeasons[i].gamesPlayed * w;
  }

  const teamPriorSv = teamAdjustedExpectedSv(teamGoalsAgainstPerGame);
  const shrunkSv = empiricalBayesSavePct(
    weightedSaves,
    weightedSa,
    teamPriorSv,
    EB_PRIOR_SHOTS,
  );
  const gsaaTotal = gsaa(weightedSaves, weightedSa);
  const gsaxTotal = gsaxProxy(weightedSaves, weightedSa, teamGoalsAgainstPerGame);
  const shotsPerGame = weightedGp > 0 ? weightedSa / weightedGp : 28;
  const gsaaRatePer60Shots =
    weightedSa > 0 ? (gsaaTotal / weightedSa) * 60 : 0;

  const winRate = weightedRate(shotSeasons, weights, (s) =>
    s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0,
  );
  const shutoutRate = weightedRate(shotSeasons, weights, (s) =>
    s.gamesPlayed > 0 ? s.shutouts / s.gamesPlayed : 0,
  );

  return {
    savePct: shrunkSv,
    gsaa: gsaaTotal,
    gsaxProxy: gsaxTotal,
    gsaaPer60: gsaaRatePer60Shots,
    shotsPerGame,
    totalWeightedShots: weightedSa,
    winRate,
    shutoutRate,
    source: `${recent.length}-season EWMA + EB (prior ${EB_PRIOR_SHOTS} SA)`,
  };
}

export function careerGoalieShots(profile: PlayerProfile): GoalieSeasonShots | null {
  const career = profile.careerTotals;
  const gp = finite(career.gamesPlayed);
  if (gp < MIN_SEASON_GP) return null;

  const saves = finite(career.saves ?? career.shotsAgainst);
  const shotsAgainst = deriveShotsAgainst(
    saves,
    career.savePctg ?? career.savePct,
    finite(career.shotsAgainst) || undefined,
  );

  return {
    gamesPlayed: gp,
    saves,
    shotsAgainst,
    goalsAgainst: deriveGoalsAgainst(
      shotsAgainst,
      saves,
      finite(career.goalsAgainst),
    ),
    wins: finite(career.wins),
    shutouts: finite(career.shutouts),
  };
}

export function estimateShrunkGoalieSkillFromCareer(
  profile: PlayerProfile,
  teamGoalsAgainstPerGame: number,
): ShrunkGoalieSkill | null {
  const career = careerGoalieShots(profile);
  if (!career) return null;

  const teamPriorSv = teamAdjustedExpectedSv(teamGoalsAgainstPerGame);
  const shrunkSv = empiricalBayesSavePct(
    career.saves,
    career.shotsAgainst,
    teamPriorSv,
    EB_PRIOR_SHOTS,
  );

  return {
    savePct: shrunkSv,
    gsaa: gsaa(career.saves, career.shotsAgainst),
    gsaxProxy: gsaxProxy(career.saves, career.shotsAgainst, teamGoalsAgainstPerGame),
    gsaaPer60:
      career.shotsAgainst > 0
        ? (gsaa(career.saves, career.shotsAgainst) / career.shotsAgainst) * 60
        : 0,
    shotsPerGame: career.shotsAgainst / career.gamesPlayed,
    totalWeightedShots: career.shotsAgainst,
    winRate: career.wins / career.gamesPlayed,
    shutoutRate: career.shutouts / career.gamesPlayed,
    source: `career EB (prior ${EB_PRIOR_SHOTS} SA)`,
  };
}

/** Translate save skill above/below average into a modest win-rate multiplier. */
export function saveSkillWinMultiplier(shrunkSv: number, leagueSv = LEAGUE_SV_PCT): number {
  const delta = shrunkSv - leagueSv;
  return Math.max(0.88, Math.min(1.12, 1 + delta / 0.015 * 0.06));
}
