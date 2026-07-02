export const NHL_TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET",
  "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT",
  "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
  "WPG", "WSH",
] as const;

export const PROJECTION_SEASON = "2026-27";
export const PROJECTION_SEASON_ID = 20262027;
export const BASE_SEASON_IDS = [20232024, 20242025, 20252026] as const;

const STATS_BASE = "https://api.nhle.com/stats/rest/en";

export interface RawSkaterSummary {
  playerId: number;
  skaterFullName: string;
  teamAbbrevs: string;
  positionCode: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  ppPoints: number;
  penaltyMinutes: number;
  faceoffWinPct: number | null;
  plusMinus?: number;
  evGoals?: number;
  evPoints?: number;
  shootingPct?: number;
  timeOnIcePerGame?: number;
}

export interface RawSkaterRealtime {
  playerId: number;
  blockedShots: number;
  hits: number;
  gamesPlayed: number;
  giveaways?: number;
  takeaways?: number;
}

export interface RawSkaterFaceoffs {
  playerId: number;
  totalFaceoffs: number;
  faceoffWinPct: number | null;
}

export interface RawGoalieSummary {
  playerId: number;
  goalieFullName: string;
  teamAbbrevs: string;
  gamesPlayed: number;
  wins: number;
  shutouts: number;
  saves: number;
  savePct: number;
  losses?: number;
  goalsAgainstAverage?: number;
  gamesStarted?: number;
}

export interface RosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  positionCode: string;
  birthDate?: string;
}

export interface PlayerLanding {
  playerId: number;
  isActive: boolean;
  currentTeamAbbrev: string;
  firstName: { default: string };
  lastName: { default: string };
  sweaterNumber: number;
  position: string;
  heightInInches: number;
  weightInPounds: number;
  birthDate: string;
  birthCity: { default: string };
  birthCountry: string;
  shootsCatches: string;
  draftDetails?: {
    year: number;
    teamAbbrev: string;
    round: number;
    pickInRound: number;
    overallPick: number;
  };
  careerTotals?: {
    regularSeason?: Record<string, number>;
  };
  awards?: Array<{ trophy?: { default: string } }>;
  last5Games?: Record<string, number>[];
}

export interface TeamStanding {
  teamAbbrev: string;
  leagueRank: number;
  pointPctg: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDifferential: number;
  l10Wins: number;
  l10GoalsFor: number;
  l10GoalsAgainst: number;
  clinchIndicator: string;
}

export async function fetchJson<T>(url: string, retries = 3): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: 3600 },
    });
    if (res.status === 429 && attempt < retries - 1) {
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new Error(`NHL API error ${res.status}: ${url}`);
    return res.json() as Promise<T>;
  }
  throw new Error(`NHL API failed after retries: ${url}`);
}

export function seasonIdToLabel(seasonId: number): string {
  const s = String(seasonId);
  return `${s.slice(0, 4)}-${s.slice(6, 8)}`;
}

export async function fetchSkaterSummaries(
  seasonId: number,
): Promise<RawSkaterSummary[]> {
  const url = `${STATS_BASE}/skater/summary?cayenneExp=seasonId=${seasonId}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterSummary[] }>(url);
  return data.data;
}

export async function fetchSkaterRealtime(
  seasonId: number,
): Promise<RawSkaterRealtime[]> {
  const url = `${STATS_BASE}/skater/realtime?cayenneExp=seasonId=${seasonId}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterRealtime[] }>(url);
  return data.data;
}

export async function fetchSkaterFaceoffs(
  seasonId: number,
): Promise<RawSkaterFaceoffs[]> {
  const url = `${STATS_BASE}/skater/faceoffpercentages?cayenneExp=seasonId=${seasonId}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterFaceoffs[] }>(url);
  return data.data;
}

export async function fetchSkaterStatReport(
  report: string,
  seasonId: number,
): Promise<Array<Record<string, unknown> & { playerId: number }>> {
  try {
    const url = `${STATS_BASE}/skater/${report}?cayenneExp=seasonId=${seasonId}&limit=-1`;
    const data = await fetchJson<{
      data: Array<Record<string, unknown> & { playerId: number }>;
    }>(url);
    return data.data;
  } catch {
    return [];
  }
}

export async function fetchGoalieSummaries(
  seasonId: number,
): Promise<RawGoalieSummary[]> {
  const url = `${STATS_BASE}/goalie/summary?cayenneExp=seasonId=${seasonId}&limit=-1`;
  const data = await fetchJson<{ data: RawGoalieSummary[] }>(url);
  return data.data;
}

export async function fetchTeamStandings(): Promise<TeamStanding[]> {
  try {
    const data = await fetchJson<{
      standings: Array<{
        teamAbbrev: { default: string };
        leagueSequence: number;
        pointPctg: number;
        goalFor: number;
        goalAgainst: number;
        gamesPlayed: number;
        goalDifferential: number;
        l10Wins: number;
        l10GoalsFor: number;
        l10GoalsAgainst: number;
        clinchIndicator?: string;
      }>;
    }>("https://api-web.nhle.com/v1/standings/now", 5);

    return data.standings.map((t) => ({
      teamAbbrev: t.teamAbbrev.default,
      leagueRank: t.leagueSequence,
      pointPctg: t.pointPctg,
      goalsForPerGame: t.gamesPlayed > 0 ? t.goalFor / t.gamesPlayed : 2.8,
      goalsAgainstPerGame: t.gamesPlayed > 0 ? t.goalAgainst / t.gamesPlayed : 2.8,
      goalDifferential: t.goalDifferential,
      l10Wins: t.l10Wins,
      l10GoalsFor: t.l10GoalsFor,
      l10GoalsAgainst: t.l10GoalsAgainst,
      clinchIndicator: t.clinchIndicator ?? "",
    }));
  } catch {
    return NHL_TEAMS.map((team, i) => ({
      teamAbbrev: team,
      leagueRank: i + 1,
      pointPctg: 0.5,
      goalsForPerGame: 2.85,
      goalsAgainstPerGame: 2.85,
      goalDifferential: 0,
      l10Wins: 5,
      l10GoalsFor: 30,
      l10GoalsAgainst: 30,
      clinchIndicator: "",
    }));
  }
}

export async function fetchTeamRoster(
  team: string,
  seasonId: number = PROJECTION_SEASON_ID,
): Promise<RosterPlayer[]> {
  const url = `https://api-web.nhle.com/v1/roster/${team}/${seasonId}`;
  try {
    const data = await fetchJson<{
      forwards?: RosterPlayer[];
      defensemen?: RosterPlayer[];
      goalies?: RosterPlayer[];
    }>(url);
    return [
      ...(data.forwards ?? []),
      ...(data.defensemen ?? []),
      ...(data.goalies ?? []),
    ];
  } catch {
    const fallbackUrl = `https://api-web.nhle.com/v1/roster/${team}/${seasonId - 10001}`;
    const data = await fetchJson<{
      forwards?: RosterPlayer[];
      defensemen?: RosterPlayer[];
      goalies?: RosterPlayer[];
    }>(fallbackUrl);
    return [
      ...(data.forwards ?? []),
      ...(data.defensemen ?? []),
      ...(data.goalies ?? []),
    ];
  }
}

export function mapNhlPosition(code: string): "C" | "LW" | "RW" | "D" | "G" {
  switch (code) {
    case "C":
      return "C";
    case "L":
      return "LW";
    case "R":
      return "RW";
    case "D":
      return "D";
    case "G":
      return "G";
    default:
      return "C";
  }
}

export function computeFaceoffWins(
  totalFaceoffs: number,
  faceoffWinPct: number | null,
): number {
  if (!totalFaceoffs || faceoffWinPct == null) return 0;
  return Math.round(totalFaceoffs * faceoffWinPct);
}
