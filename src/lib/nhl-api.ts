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
}

export interface RawSkaterRealtime {
  playerId: number;
  blockedShots: number;
  hits: number;
  gamesPlayed: number;
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
}

export interface RosterPlayer {
  id: number;
  firstName: { default: string };
  lastName: { default: string };
  positionCode: string;
  birthDate?: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`NHL API error ${res.status}: ${url}`);
  return res.json() as Promise<T>;
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

export async function fetchGoalieSummaries(
  seasonId: number,
): Promise<RawGoalieSummary[]> {
  const url = `${STATS_BASE}/goalie/summary?cayenneExp=seasonId=${seasonId}&limit=-1`;
  const data = await fetchJson<{ data: RawGoalieSummary[] }>(url);
  return data.data;
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
