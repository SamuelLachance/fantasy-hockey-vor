import type { PlayerProfile, SeasonHistory } from "./profile-types";
import {
  estimateShrunkGoalieSkill,
  estimateShrunkGoalieSkillFromCareer,
  goalieSkillWinMultiplier,
  LEAGUE_GA_PER_GAME,
  LEAGUE_SV_PCT,
  projectGoalieSaveStats,
} from "./goalie-skill";
import {
  anchorSkaterProjectionToHistory,
  clampGoalieProjection,
  clampSkaterProjection,
} from "./projection-sanity";
import { rookieSkaterProjection } from "./projections";
import type { GoalieProjection, Position, SkaterProjection } from "./types";
import { isCenterEligible } from "./yahoo-positions";
import {
  GOALIE_BACKUP_GP,
  GOALIE_STARTER_GP,
  goalieRoleLabel,
  projectedGamesFromProfile,
  projectedGoalieGames,
  type GoalieRole,
} from "./projection-gp";

const MIN_SEASON_GP = 10;
const SEASON_WEIGHTS = [0.15, 0.3, 0.55];
const FULL_SEASON_GP = 82;

const LEAGUE_GOALIE_RATES = {
  winRate: 0.45,
  shutoutRate: 0.04,
  savesPerGame: 28,
  savePct: LEAGUE_SV_PCT,
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

/** EWMA of season values that are already rates (e.g. save%), not season totals. */
function weightedSeasonAverage(
  seasons: SeasonHistory[],
  rateFn: (season: SeasonHistory) => number,
): number {
  const eligible = seasons.filter((s) => s.gamesPlayed >= MIN_SEASON_GP);
  if (eligible.length === 0) return 0;
  const recent = eligible.slice(-3);
  const weights = SEASON_WEIGHTS.slice(-recent.length);
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  return recent.reduce(
    (sum, season, i) => sum + rateFn(season) * (weights[i] / totalWeight),
    0,
  );
}

const MAX_GOALIE_WIN_RATE = 0.62;

function careerSkaterRates(profile: PlayerProfile) {
  const career = profile.careerTotals;
  const gp = finite(career.gamesPlayed);
  if (gp < MIN_SEASON_GP) return null;

  const last = profile.teamHistory
    .filter((s) => !s.isGoalie && s.gamesPlayed >= MIN_SEASON_GP)
    .slice(-1)[0];

  return {
    goals: perGame(finite(career.goals), gp),
    assists: perGame(finite(career.assists), gp),
    shots: perGame(finite(career.shots), gp),
    blocks: last ? perGame(finite(last.advanced.blocks), last.gamesPlayed) : 0,
    hits: last ? perGame(finite(last.advanced.hits), last.gamesPlayed) : 0,
    powerplayPoints: perGame(finite(career.powerPlayPoints), gp),
    penaltyMinutes: perGame(finite(career.pim), gp),
    faceoffWins: last
      ? perGame(finite(last.advanced.faceoffWins), last.gamesPlayed)
      : 0,
  };
}

function applySkaterRates(
  rates: {
    goals: number;
    assists: number;
    shots: number;
    blocks: number;
    hits: number;
    powerplayPoints: number;
    penaltyMinutes: number;
    faceoffWins: number;
  },
  profile: PlayerProfile,
  gamesPlayed: number,
  mult: number,
  teamMult: number,
): SkaterProjection {
  return clampSkaterProjection(
    {
      goals: Math.round(rates.goals * gamesPlayed * mult),
      assists: Math.round(rates.assists * gamesPlayed * mult),
      shots: Math.round(rates.shots * gamesPlayed * mult * 1.02),
      blocks: Math.round(
        rates.blocks * gamesPlayed * (profile.position === "D" ? 1.05 : 1),
      ),
      hits: Math.round(rates.hits * gamesPlayed),
      powerplayPoints: Math.round(rates.powerplayPoints * gamesPlayed * teamMult),
      penaltyMinutes: Math.round(rates.penaltyMinutes * gamesPlayed),
      faceoffWins: Math.round(
        rates.faceoffWins *
          gamesPlayed *
          (isCenterEligible(profile)
            ? 1.05
            : profile.position === "D"
              ? 0
              : 0.3),
      ),
    },
    gamesPlayed,
    profile.position,
  );
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
    if (age >= 37) return 0.82;
    if (age >= 34) return 0.9;
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
  if (age >= 36) return 0.84;
  if (age >= 33) return 0.91;
  return 1;
}

function projectedSkaterGames(profile: PlayerProfile): number {
  return projectedGamesFromProfile(profile);
}

export function projectSkaterFromProfile(
  profile: PlayerProfile,
): { projection: SkaterProjection; gamesPlayed: number; reasoning: string } {
  const seasons = profile.teamHistory.filter((s) => !s.isGoalie);
  const last = seasons[seasons.length - 1];
  const prev = seasons[seasons.length - 2];
  const gamesPlayed = projectedSkaterGames(profile);

  const teamMult = teamOffenseMultiplier(profile);
  const ageMult = ageCurve(profile.position, profile.bio.age);
  const draftMult = draftPedigreeMultiplier(profile);
  const trendMult = last && prev ? trendMultiplier(last.stats.points ?? 0, prev.stats.points ?? 0) : 1;

  const eligibleGp = seasons
    .filter((s) => s.gamesPlayed >= MIN_SEASON_GP)
    .reduce((sum, s) => sum + s.gamesPlayed, 0);

  let rates = {
    goals: weightedPerGameRate(seasons, (s) => finite(s.stats.goals)),
    assists: weightedPerGameRate(seasons, (s) => finite(s.stats.assists)),
    shots: weightedPerGameRate(seasons, (s) => finite(s.stats.shots)),
    blocks: weightedPerGameRate(seasons, (s) => finite(s.advanced.blocks)),
    hits: weightedPerGameRate(seasons, (s) => finite(s.advanced.hits)),
    powerplayPoints: weightedPerGameRate(seasons, (s) => finite(s.stats.ppPoints)),
    penaltyMinutes: weightedPerGameRate(seasons, (s) => finite(s.stats.pim)),
    faceoffWins: weightedPerGameRate(seasons, (s) => finite(s.advanced.faceoffWins)),
  };
  let source = "recent seasons";

  if (eligibleGp < MIN_SEASON_GP) {
    const career = careerSkaterRates(profile);
    if (career) {
      rates = career;
      source = "career totals";
    } else {
      const baseline = rookieSkaterProjection(profile.position);
      const baselineGp = FULL_SEASON_GP;
      rates = {
        goals: baseline.goals / baselineGp,
        assists: baseline.assists / baselineGp,
        shots: baseline.shots / baselineGp,
        blocks: baseline.blocks / baselineGp,
        hits: baseline.hits / baselineGp,
        powerplayPoints: baseline.powerplayPoints / baselineGp,
        penaltyMinutes: baseline.penaltyMinutes / baselineGp,
        faceoffWins: baseline.faceoffWins / baselineGp,
      };
      source = "position baseline";
    }
  }

  const usageSeason = seasons.filter((s) => s.gamesPlayed >= MIN_SEASON_GP).slice(-1)[0] ?? last;
  const usageBoost =
    finite(usageSeason?.advanced.satFor60) > 0
      ? Math.min(1.12, 1 + finite(usageSeason?.advanced.satFor60) / 100)
      : 1;

  const mult = teamMult * ageMult * draftMult * trendMult * usageBoost;

  const projection = anchorSkaterProjectionToHistory(
    profile,
    applySkaterRates(rates, profile, gamesPlayed, mult, teamMult),
    gamesPlayed,
  );

  const reasoning = [
    `Rates from ${source}`,
    `Projected ${gamesPlayed} GP (full season)`,
    `Team offense mult ${teamMult.toFixed(2)} (#${profile.teamContext.leagueRank} ${profile.teamContext.teamAbbrev})`,
    `Age ${profile.bio.age} curve ${ageMult.toFixed(2)}`,
    profile.draft ? `Draft #${profile.draft.overallPick} pedigree ${draftMult.toFixed(2)}` : "Undrafted",
  ].join("; ");

  return { projection, gamesPlayed, reasoning };
}

export function projectGoalieFromProfile(
  profile: PlayerProfile,
  goalieRoleMap?: Map<number, GoalieRole>,
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie);
  const gamesPlayed = projectedGoalieGames(profile, goalieRoleMap);
  const role = goalieRoleLabel(profile, goalieRoleMap);

  const teamWinPct = profile.teamContext.pointsPct;
  const teamGaPerGame = profile.teamContext.goalsAgainstPerGame;
  const teamGfPerGame = profile.teamContext.goalsForPerGame ?? 3.05;
  const ageMult = ageCurve("G", profile.bio.age);
  const teamBoost = 0.85 + teamWinPct * 0.3;
  const defEnvBoost = Math.max(
    0.9,
    Math.min(1.1, 1 + (LEAGUE_GA_PER_GAME - teamGaPerGame) * 0.06),
  );
  const pythWinRate = Math.max(
    0.35,
    Math.min(0.65, 0.5 + (teamGfPerGame - teamGaPerGame) * 0.11),
  );

  const eligibleGp = seasons
    .filter((s) => s.gamesPlayed >= MIN_SEASON_GP)
    .reduce((sum, s) => sum + s.gamesPlayed, 0);

  let skill = estimateShrunkGoalieSkill(profile.id, seasons, teamGaPerGame);

  if (eligibleGp < MIN_SEASON_GP) {
    const careerSkill = estimateShrunkGoalieSkillFromCareer(profile, teamGaPerGame);
    if (careerSkill) {
      skill = careerSkill;
    } else {
      skill = {
        savePct: LEAGUE_SV_PCT,
        gsaa: 0,
        gsax: 0,
        gsaxSource: "league",
        gsaxPer60: 0,
        gsaxPerGame: 0,
        gsaaPer60: 0,
        shotsPerGame: LEAGUE_GOALIE_RATES.savesPerGame,
        xGaPerGame: 2.85,
        totalWeightedShots: 0,
        winRate: LEAGUE_GOALIE_RATES.winRate,
        shutoutRate: LEAGUE_GOALIE_RATES.shutoutRate,
        source: "league baseline",
      };
    }
  }

  const skillWinMult = goalieSkillWinMultiplier(skill, teamGaPerGame);
  const ewmaWinRate = weightedPerGameRate(seasons, (s) => finite(s.stats.wins));
  const ewmaShutoutRate = weightedPerGameRate(seasons, (s) => finite(s.stats.shutouts));

  let winRate =
    ewmaWinRate > 0
      ? ewmaWinRate
      : skill.winRate > 0
        ? skill.winRate
        : LEAGUE_GOALIE_RATES.winRate;
  let shutoutRate =
    ewmaShutoutRate > 0
      ? ewmaShutoutRate
      : skill.shutoutRate > 0
        ? skill.shutoutRate
        : LEAGUE_GOALIE_RATES.shutoutRate;
  if (skill.gsaxPerGame > 0) {
    shutoutRate *= Math.min(1.2, 1 + skill.gsaxPerGame * 0.08);
  } else if (skill.gsaxPerGame < 0) {
    shutoutRate *= Math.max(0.8, 1 + skill.gsaxPerGame * 0.06);
  }

  winRate = Math.min(
    MAX_GOALIE_WIN_RATE,
    winRate * ageMult * teamBoost * defEnvBoost * skillWinMult,
  );
  winRate = winRate * 0.72 + pythWinRate * skillWinMult * 0.28;
  winRate = Math.min(MAX_GOALIE_WIN_RATE, winRate);
  shutoutRate *= ageMult;

  const { saves: projectedSaves, savePct: rawSavePct } = projectGoalieSaveStats(
    skill,
    gamesPlayed,
  );
  const ewmaSv = weightedSeasonAverage(seasons, (s) =>
    normalizeSavePct(s.stats.savePct),
  );
  const savePct =
    ewmaSv > 0
      ? Math.round((ewmaSv * 0.55 + rawSavePct * 0.45) * 10000) / 10000
      : Math.round(rawSavePct * 10000) / 10000;
  const ewmaSaves = weightedPerGameRate(seasons, (s) => finite(s.stats.saves));
  const saves =
    ewmaSaves > 0
      ? Math.round(ewmaSaves * gamesPlayed * 0.6 + projectedSaves * 0.4)
      : projectedSaves;

  const projection = clampGoalieProjection(
    {
      wins: Math.round(winRate * gamesPlayed),
      // shutoutRate already includes ageMult (applied above).
      shutouts: Math.round(shutoutRate * gamesPlayed),
      saves,
      savePct: Math.round(savePct * 10000) / 10000,
    },
    gamesPlayed,
  );

  const reasoning = [
    skill.source,
    skill.gsaxSource === "moneypuck"
      ? `GSAx ${skill.gsax >= 0 ? "+" : ""}${skill.gsax.toFixed(1)} (${skill.gsaxPerGame.toFixed(2)}/GP), save% ${savePct.toFixed(3)}`
      : `EB save% ${savePct.toFixed(3)} (proxy GSAx ${skill.gsax >= 0 ? "+" : ""}${skill.gsax.toFixed(1)})`,
    `${skill.shotsPerGame.toFixed(1)} SOG/GP × ${gamesPlayed} GP (${role}, ${role === "starter" ? GOALIE_STARTER_GP : GOALIE_BACKUP_GP} GP baseline)`,
    `Team GA/G ${teamGaPerGame.toFixed(2)} win mult ${skillWinMult.toFixed(2)}`,
    `Age ${profile.bio.age}`,
  ].join("; ");

  return { projection, gamesPlayed, reasoning };
}
