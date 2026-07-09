import type { PlayerProfile, SeasonHistory } from "./profile-types";
import {
  empiricalBayesGsax,
  empiricalBayesGsaxPer60,
  expectedSavePctOnShots,
  loadMoneyPuckRegistrySync,
  lookupMoneyPuckGoalieSeason,
  type MoneyPuckGoalieRegistry,
  type MoneyPuckGoalieSeason,
} from "./moneypuck-goalies";

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

export type GsaxSource = "moneypuck" | "proxy" | "league";

export interface ShrunkGoalieSkill {
  savePct: number;
  gsaa: number;
  gsax: number;
  gsaxSource: GsaxSource;
  gsaxPer60: number;
  gsaxPerGame: number;
  gsaaPer60: number;
  shotsPerGame: number;
  xGaPerGame: number;
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

/** Beta-binomial / conjugate shrinkage of save% toward a prior mean. */
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

/** Fallback GSAx when MoneyPuck data is unavailable. */
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

function estimateFromMoneyPuck(
  mpRows: MoneyPuckGoalieSeason[],
  weights: number[],
  nhlSeasons: GoalieSeasonShots[],
): ShrunkGoalieSkill {
  let wGsax = 0;
  let wXga = 0;
  let wToi = 0;
  let wGp = 0;
  let wOngoal = 0;
  let wSaves = 0;

  for (let i = 0; i < mpRows.length; i++) {
    const w = weights[i];
    const mp = mpRows[i];
    wGsax += mp.gsax * w;
    wXga += mp.xGoalsAgainst * w;
    wToi += mp.icetimeSeconds * w;
    wGp += mp.gamesPlayed * w;
    wOngoal += mp.shotsOnGoalAgainst * w;
    wSaves += (mp.shotsOnGoalAgainst - mp.goalsAgainst) * w;
  }

  const shrunkGsax = empiricalBayesGsax(wGsax, wXga);
  const gsaxPer60 = empiricalBayesGsaxPer60(wGsax, wToi);
  const gsaxPerGame = wGp > 0 ? shrunkGsax / wGp : 0;
  const xGaPerGame = wGp > 0 ? wXga / wGp : 2.85;
  const shotsPerGame = wGp > 0 ? wOngoal / wGp : 28;
  const xSavePrior = expectedSavePctOnShots(wXga, wOngoal);
  const shrunkSv = empiricalBayesSavePct(wSaves, wOngoal, xSavePrior, EB_PRIOR_SHOTS);

  const winRate = weightedRate(nhlSeasons, weights, (s) =>
    s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0,
  );
  const shutoutRate = weightedRate(nhlSeasons, weights, (s) =>
    s.gamesPlayed > 0 ? s.shutouts / s.gamesPlayed : 0,
  );

  return {
    savePct: shrunkSv,
    gsaa: gsaa(wSaves, wOngoal),
    gsax: shrunkGsax,
    gsaxSource: "moneypuck",
    gsaxPer60,
    gsaxPerGame,
    gsaaPer60: wOngoal > 0 ? (gsaa(wSaves, wOngoal) / wOngoal) * 60 : 0,
    shotsPerGame,
    xGaPerGame,
    totalWeightedShots: wOngoal,
    winRate,
    shutoutRate,
    source: `MoneyPuck xG (${mpRows.length}-season EWMA + EB)`,
  };
}

function estimateFromProxy(
  shotSeasons: GoalieSeasonShots[],
  weights: number[],
  teamGoalsAgainstPerGame: number,
  seasonCount: number,
): ShrunkGoalieSkill {
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
  const proxyXga =
    weightedSa * teamAdjustedGoalRatePerShot(teamGoalsAgainstPerGame);
  const shrunkGsax = empiricalBayesGsax(gsaxTotal, proxyXga);
  const gsaxPerGame = weightedGp > 0 ? shrunkGsax / weightedGp : 0;
  const xGaPerGame =
    weightedGp > 0
      ? (weightedSa * teamAdjustedGoalRatePerShot(teamGoalsAgainstPerGame)) / weightedGp
      : 2.85;
  const gsaxPer60 =
    weightedSa > 0 ? (shrunkGsax / weightedSa) * 60 : gsaxPer60FromPerGame(gsaxPerGame, shotsPerGame);

  return {
    savePct: shrunkSv,
    gsaa: gsaaTotal,
    gsax: shrunkGsax,
    gsaxSource: "proxy",
    gsaxPer60,
    gsaxPerGame,
    gsaaPer60: weightedSa > 0 ? (gsaaTotal / weightedSa) * 60 : 0,
    shotsPerGame,
    xGaPerGame,
    totalWeightedShots: weightedSa,
    winRate: weightedRate(shotSeasons, weights, (s) =>
      s.gamesPlayed > 0 ? s.wins / s.gamesPlayed : 0,
    ),
    shutoutRate: weightedRate(shotSeasons, weights, (s) =>
      s.gamesPlayed > 0 ? s.shutouts / s.gamesPlayed : 0,
    ),
    source: `${seasonCount}-season EWMA + EB proxy (prior ${EB_PRIOR_SHOTS} SA)`,
  };
}

export function estimateShrunkGoalieSkill(
  playerId: number,
  seasons: SeasonHistory[],
  teamGoalsAgainstPerGame: number,
  mpRegistry: MoneyPuckGoalieRegistry | null = loadMoneyPuckRegistrySync(),
): ShrunkGoalieSkill {
  const eligible = seasons.filter((s) => s.isGoalie && s.gamesPlayed >= MIN_SEASON_GP);
  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);

  if (recent.length === 0) {
    return {
      savePct: LEAGUE_SV_PCT,
      gsaa: 0,
      gsax: 0,
      gsaxSource: "league",
      gsaxPer60: 0,
      gsaxPerGame: 0,
      gsaaPer60: 0,
      shotsPerGame: 28,
      xGaPerGame: 2.85,
      totalWeightedShots: 0,
      winRate: 0.45,
      shutoutRate: 0.04,
      source: "league prior",
    };
  }

  const shotSeasons = recent.map(seasonToShots);
  const mpRows: MoneyPuckGoalieSeason[] = [];
  for (const s of recent) {
    const mp = lookupMoneyPuckGoalieSeason(mpRegistry, playerId, s.seasonId);
    if (mp && mp.gamesPlayed >= MIN_SEASON_GP) mpRows.push(mp);
  }

  if (mpRows.length > 0) {
    const mpWeights = weights.slice(-mpRows.length);
    return estimateFromMoneyPuck(mpRows, mpWeights, shotSeasons.slice(-mpRows.length));
  }

  return estimateFromProxy(
    shotSeasons,
    weights,
    teamGoalsAgainstPerGame,
    recent.length,
  );
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
  mpRegistry: MoneyPuckGoalieRegistry | null = loadMoneyPuckRegistrySync(),
): ShrunkGoalieSkill | null {
  const goalieSeasons = profile.teamHistory.filter(
    (s) => s.isGoalie && s.gamesPlayed >= MIN_SEASON_GP,
  );
  const mpRows: MoneyPuckGoalieSeason[] = [];
  for (const s of goalieSeasons) {
    const mp = lookupMoneyPuckGoalieSeason(mpRegistry, profile.id, s.seasonId);
    if (mp) mpRows.push(mp);
  }

  if (mpRows.length >= 2) {
    const weights = mpRows.map((_, i) => (i + 1) / mpRows.length);
    const nhlRows = goalieSeasons
      .filter((s) =>
        mpRows.some((mp) => mp.seasonId === s.seasonId),
      )
      .map(seasonToShots);
    return estimateFromMoneyPuck(mpRows, weights, nhlRows);
  }

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
    gsax: gsaxProxy(career.saves, career.shotsAgainst, teamGoalsAgainstPerGame),
    gsaxSource: "proxy",
    gsaxPer60: 0,
    gsaxPerGame: 0,
    gsaaPer60:
      career.shotsAgainst > 0
        ? (gsaa(career.saves, career.shotsAgainst) / career.shotsAgainst) * 60
        : 0,
    shotsPerGame: career.shotsAgainst / career.gamesPlayed,
    xGaPerGame: 2.85,
    totalWeightedShots: career.shotsAgainst,
    winRate: career.wins / career.gamesPlayed,
    shutoutRate: career.shutouts / career.gamesPlayed,
    source: `career EB proxy (prior ${EB_PRIOR_SHOTS} SA)`,
  };
}

/** GSAx skill → win-rate multiplier (stronger GSAx signal for production). */
export function gsaxWinMultiplier(gsaxPer60: number): number {
  return Math.max(0.82, Math.min(1.18, 1 + (gsaxPer60 / 10) * 0.1));
}

/** Re-base GSAx/60 to projected team defensive environment. */
export function teamAdjustedGsaxPer60(
  gsaxPer60: number,
  teamGoalsAgainstPerGame: number,
  leagueGoalsAgainstPerGame = LEAGUE_GA_PER_GAME,
): number {
  if (gsaxPer60 === 0) return 0;
  const teamFactor = Math.max(
    0.88,
    Math.min(1.12, leagueGoalsAgainstPerGame / teamGoalsAgainstPerGame),
  );
  return gsaxPer60 * teamFactor;
}

/** Derive GSAx/60 from per-game GSAx and shot volume. */
export function gsaxPer60FromPerGame(
  gsaxPerGame: number,
  shotsPerGame: number,
): number {
  if (gsaxPerGame === 0 || shotsPerGame <= 0) return 0;
  return (gsaxPerGame / shotsPerGame) * 60;
}

/** Translate save skill above/below average into a win-rate multiplier. */
export function saveSkillWinMultiplier(shrunkSv: number, leagueSv = LEAGUE_SV_PCT): number {
  const delta = shrunkSv - leagueSv;
  return Math.max(0.82, Math.min(1.18, 1 + (delta / 0.015) * 0.1));
}

/** Combined win multiplier preferring team-adjusted MoneyPuck/proxy GSAx. */
export function goalieSkillWinMultiplier(
  skill: ShrunkGoalieSkill,
  teamGoalsAgainstPerGame = LEAGUE_GA_PER_GAME,
): number {
  let gsaxPer60 = skill.gsaxPer60;
  if (gsaxPer60 === 0 && skill.gsaxPerGame !== 0) {
    gsaxPer60 = gsaxPer60FromPerGame(skill.gsaxPerGame, skill.shotsPerGame);
  }
  if (gsaxPer60 !== 0) {
    const adjusted = teamAdjustedGsaxPer60(gsaxPer60, teamGoalsAgainstPerGame);
    return gsaxWinMultiplier(adjusted);
  }
  const teamSv = teamAdjustedExpectedSv(teamGoalsAgainstPerGame);
  return saveSkillWinMultiplier(skill.savePct, teamSv);
}

/**
 * Project saves and save% from shrunk skill and projected workload.
 * Uses MoneyPuck xGA − shrunk GSAx when available.
 */
export function projectGoalieSaveStats(
  skill: ShrunkGoalieSkill,
  projectedGp: number,
): { saves: number; savePct: number } {
  const shotsPerGame =
    skill.shotsPerGame > 0 ? skill.shotsPerGame : 28;
  const projectedShots = shotsPerGame * projectedGp;

  if (skill.gsaxSource === "moneypuck" && skill.xGaPerGame > 0) {
    const projectedXga = skill.xGaPerGame * projectedGp;
    const projectedGsax = skill.gsaxPerGame * projectedGp;
    const projectedGa = Math.max(0, projectedXga - projectedGsax);
    const saves = Math.round(Math.max(0, projectedShots - projectedGa));
    const savePct =
      projectedShots > 0
        ? Math.max(0.875, Math.min(0.93, saves / projectedShots))
        : skill.savePct;
    return { saves, savePct };
  }

  const savePct = Math.max(0.875, Math.min(0.93, skill.savePct));
  return {
    saves: Math.round(savePct * projectedShots),
    savePct,
  };
}
