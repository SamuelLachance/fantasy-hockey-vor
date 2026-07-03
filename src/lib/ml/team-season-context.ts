import { fetchJson, seasonIdToLabel } from "../nhl-api";
import type { TeamSeasonContext } from "./context-types";

const ESPN_TEAMS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams?limit=50";

interface StandingsSeasonMeta {
  id: number;
  standingsEnd: string;
}

interface NhlStandingRow {
  seasonId: number;
  teamAbbrev: { default: string };
  leagueSequence: number;
  pointPctg: number;
  gamesPlayed: number;
  goalFor: number;
  goalAgainst: number;
  goalDifferential: number;
}

let espnTeamIdByAbbrev: Map<string, string> | null = null;

async function getEspnTeamIds(): Promise<Map<string, string>> {
  if (espnTeamIdByAbbrev) return espnTeamIdByAbbrev;

  const data = await fetchJson<{
    sports: Array<{
      leagues: Array<{
        teams: Array<{ team: { id: string; abbreviation: string } }>;
      }>;
    }>;
  }>(ESPN_TEAMS_URL);

  espnTeamIdByAbbrev = new Map();
  for (const t of data.sports?.[0]?.leagues?.[0]?.teams ?? []) {
    espnTeamIdByAbbrev.set(t.team.abbreviation.toUpperCase(), t.team.id);
  }
  // Legacy / alias abbrevs
  espnTeamIdByAbbrev.set("SJ", espnTeamIdByAbbrev.get("SJS") ?? "18");
  espnTeamIdByAbbrev.set("LA", espnTeamIdByAbbrev.get("LAK") ?? "8");
  espnTeamIdByAbbrev.set("NJ", espnTeamIdByAbbrev.get("NJD") ?? "19");
  espnTeamIdByAbbrev.set("TB", espnTeamIdByAbbrev.get("TBL") ?? "23");
  espnTeamIdByAbbrev.set("UTA", espnTeamIdByAbbrev.get("UTA") ?? "37");
  espnTeamIdByAbbrev.set("ARI", espnTeamIdByAbbrev.get("UTA") ?? "37");

  return espnTeamIdByAbbrev;
}

export function espnSeasonYearFromSeasonId(seasonId: number): number {
  return Number(String(seasonId).slice(0, 4)) + 1;
}

export function computeTeamElo(
  pointPctg: number,
  leagueRank: number,
  goalDiffPerGame: number,
): number {
  const rankScore = (33 - leagueRank) / 32;
  return pointPctg * 500 + rankScore * 500 + goalDiffPerGame * 10;
}

async function fetchStandingsEndDates(): Promise<Map<number, string>> {
  const data = await fetchJson<{ seasons: StandingsSeasonMeta[] }>(
    "https://api-web.nhle.com/v1/standings-season",
  );
  const map = new Map<number, string>();
  for (const s of data.seasons) {
    map.set(s.id, s.standingsEnd);
  }
  return map;
}

async function fetchCoachForTeamSeason(
  espnTeamId: string,
  espnSeasonYear: number,
): Promise<{ coachId: number; coachName: string } | null> {
  try {
    const url = `https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/${espnTeamId}/roster?season=${espnSeasonYear}`;
    const data = await fetchJson<{
      coach?: Array<{ id: string; firstName: string; lastName: string }>;
    }>(url);
    const coach = data.coach?.[0];
    if (!coach) return null;
    return {
      coachId: Number(coach.id),
      coachName: `${coach.firstName} ${coach.lastName}`,
    };
  } catch {
    return null;
  }
}

export async function buildTeamSeasonContexts(
  seasonIds: readonly number[],
  onProgress?: (msg: string) => void,
): Promise<TeamSeasonContext[]> {
  const endDates = await fetchStandingsEndDates();
  const espnTeams = await getEspnTeamIds();
  const contexts: TeamSeasonContext[] = [];
  const tenureTracker = new Map<string, { coachId: number; seasons: number }>();

  for (const seasonId of seasonIds) {
    const endDate = endDates.get(seasonId);
    if (!endDate) continue;

    onProgress?.(`Team context: standings ${seasonIdToLabel(seasonId)}`);
    const standings = await fetchJson<{ standings: NhlStandingRow[] }>(
      `https://api-web.nhle.com/v1/standings/${endDate}`,
    );

    const espnYear = espnSeasonYearFromSeasonId(seasonId);

    const coachJobs = standings.standings.map(async (row) => {
      const team = row.teamAbbrev.default.toUpperCase();
      const gp = Math.max(1, row.gamesPlayed);
      const goalDiffPerGame = row.goalDifferential / gp;
      const pointPctg = row.pointPctg;
      const leagueRank = row.leagueSequence;
      const teamElo = computeTeamElo(pointPctg, leagueRank, goalDiffPerGame);

      const espnId = espnTeams.get(team);
      let coachId = 0;
      let coachTenureSeasons = 0;

      if (espnId) {
        const coach = await fetchCoachForTeamSeason(espnId, espnYear);
        if (coach) {
          coachId = coach.coachId;
          const tenureKey = `${team}|${coachId}`;
          const prev = tenureTracker.get(tenureKey);
          coachTenureSeasons = prev ? prev.seasons + 1 : 1;
          tenureTracker.set(tenureKey, { coachId, seasons: coachTenureSeasons });
        }
      }

      return {
        seasonId,
        team,
        pointPctg,
        leagueRank,
        goalsForPerGame: row.goalFor / gp,
        goalsAgainstPerGame: row.goalAgainst / gp,
        goalDiffPerGame,
        teamElo,
        coachId,
        coachTenureSeasons,
      } satisfies TeamSeasonContext;
    });

    const batchSize = 4;
    for (let i = 0; i < coachJobs.length; i += batchSize) {
      const batch = await Promise.all(coachJobs.slice(i, i + batchSize));
      contexts.push(...batch);
      await new Promise((r) => setTimeout(r, 100));
    }

    await new Promise((r) => setTimeout(r, 200));
  }

  return contexts;
}
