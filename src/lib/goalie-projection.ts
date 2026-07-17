import type { PlayerProfile } from "./profile-types";
import type { GoalieProjection } from "./types";
import type { PlayerSeasonRow } from "./ml/types";
import { clampGoalieProjection } from "./projection-sanity";

const FULL_SEASON = 82;
const LEAGUE_SHUTOUT_RATE = 0.04;
const LEAGUE_SAVE_PCT = 0.905;
/** Shrink shutouts toward league rate — holdout-tuned on 2024-25 val. */
const SHUTOUT_LAG1_WEIGHT = 0.5;

function primaryTeam(team: string): string {
  return team.split(",")[0].trim().toUpperCase();
}

function lastGoalieSeason(prior: PlayerSeasonRow[]): PlayerSeasonRow | undefined {
  return prior.filter((r) => r.isGoalie && r.gamesPlayed >= 5).at(-1);
}

function normalizeSavePct(sv: number): number {
  return sv > 1 ? sv / 100 : sv > 0 ? sv : LEAGUE_SAVE_PCT;
}

export interface GoalieLag1Peer {
  playerId: number;
  lastGp: number;
}

/**
 * Split team workload by last-season GP shares, scaling down if the tandem
 * exceeded 82 GP combined. Best goalie GP holdout on 2024-25 (R²≈0.38).
 */
export function teamNormalizedLag1Gp(
  playerId: number,
  peers: GoalieLag1Peer[],
): number {
  if (peers.length === 0) return 40;
  const total = peers.reduce((s, p) => s + p.lastGp, 0);
  const scale = total > FULL_SEASON ? FULL_SEASON / total : 1;
  const me = peers.find((p) => p.playerId === playerId);
  const gp = Math.round((me?.lastGp ?? 0) * scale);
  return Math.max(5, Math.min(70, gp));
}

export function goalieLag1PeersFromRows(
  playerId: number,
  team: string,
  seasonId: number,
  rows: PlayerSeasonRow[],
  historyMap: Map<number, PlayerSeasonRow[]>,
): GoalieLag1Peer[] {
  const teamKey = primaryTeam(team);
  const seasonGoalies = rows.filter(
    (r) =>
      r.isGoalie &&
      r.seasonId === seasonId &&
      primaryTeam(r.team) === teamKey,
  );
  return seasonGoalies.map((row) => {
    const prior =
      historyMap.get(row.playerId)?.filter((r) => r.seasonId < seasonId) ?? [];
    const last = lastGoalieSeason(prior);
    return {
      playerId: row.playerId,
      // No prior season → 0, matching goalieLag1PeersFromProfiles. Falling
      // back to row.gamesPlayed would leak the target season's outcome into
      // holdout evaluation.
      lastGp: last?.gamesPlayed ?? 0,
    };
  });
}

export function goalieLag1PeersFromProfiles(
  profile: PlayerProfile,
  teamGoalies: PlayerProfile[],
): GoalieLag1Peer[] {
  const team = primaryTeam(profile.team);
  return teamGoalies
    .filter((p) => p.isGoalie && primaryTeam(p.team) === team)
    .map((p) => {
      const seasons = p.teamHistory.filter((s) => s.isGoalie && s.gamesPlayed >= 5);
      const last = seasons.at(-1);
      return {
        playerId: p.id,
        lastGp: last?.gamesPlayed ?? 0,
      };
    });
}

export function projectedGoalieGpLag1TeamNorm(
  profile: PlayerProfile,
  teamGoalies: PlayerProfile[],
): number {
  const peers = goalieLag1PeersFromProfiles(profile, teamGoalies);
  return teamNormalizedLag1Gp(profile.id, peers);
}

export function projectedGoalieGpLag1TeamNormFromRows(
  playerId: number,
  team: string,
  seasonId: number,
  rows: PlayerSeasonRow[],
  historyMap: Map<number, PlayerSeasonRow[]>,
): number {
  const peers = goalieLag1PeersFromRows(
    playerId,
    team,
    seasonId,
    rows,
    historyMap,
  );
  return teamNormalizedLag1Gp(playerId, peers);
}

/** Lag1 per-game rates with light shutout shrinkage. */
export function goalieLag1Rates(prior: PlayerSeasonRow[]): {
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
} {
  const last = lastGoalieSeason(prior);
  if (!last) {
    return {
      wins: 0.45,
      shutouts: LEAGUE_SHUTOUT_RATE,
      saves: 27,
      savePct: LEAGUE_SAVE_PCT,
    };
  }
  const gp = Math.max(1, last.gamesPlayed);
  const shutoutRate = last.shutouts / gp;
  return {
    wins: last.wins / gp,
    shutouts:
      SHUTOUT_LAG1_WEIGHT * shutoutRate +
      (1 - SHUTOUT_LAG1_WEIGHT) * LEAGUE_SHUTOUT_RATE,
    saves: last.saves / gp,
    savePct: normalizeSavePct(last.savePct),
  };
}

export function projectGoalieLag1Totals(
  prior: PlayerSeasonRow[],
  gamesPlayed: number,
): GoalieProjection {
  const rates = goalieLag1Rates(prior);
  return clampGoalieProjection(
    {
      wins: Math.round(rates.wins * gamesPlayed),
      shutouts: Math.round(rates.shutouts * gamesPlayed),
      saves: Math.round(rates.saves * gamesPlayed),
      savePct: Math.round(rates.savePct * 10000) / 10000,
    },
    gamesPlayed,
  );
}

export function goalieLag1RatesFromProfile(profile: PlayerProfile): ReturnType<
  typeof goalieLag1Rates
> {
  const seasons = profile.teamHistory.filter((s) => s.isGoalie && s.gamesPlayed >= 5);
  const last = seasons.at(-1);
  if (!last) {
    return goalieLag1Rates([]);
  }
  const gp = Math.max(1, last.gamesPlayed);
  const shutoutRate = (last.stats.shutouts ?? 0) / gp;
  return {
    wins: (last.stats.wins ?? 0) / gp,
    shutouts:
      SHUTOUT_LAG1_WEIGHT * shutoutRate +
      (1 - SHUTOUT_LAG1_WEIGHT) * LEAGUE_SHUTOUT_RATE,
    saves: (last.stats.saves ?? 0) / gp,
    savePct: normalizeSavePct(last.stats.savePct ?? LEAGUE_SAVE_PCT),
  };
}

export function projectGoalieLag1FromProfile(
  profile: PlayerProfile,
  teamGoalies: PlayerProfile[],
): { projection: GoalieProjection; gamesPlayed: number; reasoning: string } {
  const gamesPlayed = projectedGoalieGpLag1TeamNorm(profile, teamGoalies);
  const rates = goalieLag1RatesFromProfile(profile);
  const projection = clampGoalieProjection(
    {
      wins: Math.round(rates.wins * gamesPlayed),
      shutouts: Math.round(rates.shutouts * gamesPlayed),
      saves: Math.round(rates.saves * gamesPlayed),
      savePct: Math.round(rates.savePct * 10000) / 10000,
    },
    gamesPlayed,
  );
  const lastGp =
    profile.teamHistory.filter((s) => s.isGoalie).at(-1)?.gamesPlayed ?? 0;

  return {
    projection,
    gamesPlayed,
    reasoning: `Lag1 persistence: ${lastGp} GP last year → ${gamesPlayed} GP (team-normalized tandem); rates from last season`,
  };
}
