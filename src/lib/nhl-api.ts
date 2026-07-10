export const NHL_TEAMS = [
  "ANA", "BOS", "BUF", "CAR", "CBJ", "CGY", "CHI", "COL", "DAL", "DET",
  "EDM", "FLA", "LAK", "MIN", "MTL", "NJD", "NSH", "NYI", "NYR", "OTT",
  "PHI", "PIT", "SEA", "SJS", "STL", "TBL", "TOR", "UTA", "VAN", "VGK",
  "WPG", "WSH",
] as const;

export const PROJECTION_SEASON = "2026-27";
export const PROJECTION_SEASON_ID = 20262027;

/** Seasons used for live dossier collection (recent context). */
export const BASE_SEASON_IDS = [20232024, 20242025, 20252026] as const;

/** All seasons with complete skater + goalie advanced feeds on the NHL API.
 * Realtime (hits/blocks) and faceoff feeds are populated from 2005-06 onward. */
export const HISTORICAL_SEASON_IDS = [
  20052006, 20062007, 20072008, 20082009, 20092010,
  20102011, 20112012, 20122013, 20132014, 20142015, 20152016,
  20162017, 20172018, 20182019, 20192020, 20202021, 20212022,
  20222023, 20232024, 20242025, 20252026,
] as const;

/** Regular-season games scheduled per team (lockout/COVID-shortened seasons). */
export function scheduledGamesForSeason(seasonId: number): number {
  if (seasonId === 20122013) return 48;
  if (seasonId === 20192020) return 70; // COVID pause — teams played 68–71
  if (seasonId === 20202021) return 56;
  return 82;
}

export const ML_FEATURE_LAGS = 3;
export const ML_MIN_SEASON_GP = 10;

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
  shotsAgainst?: number;
  goalsAgainst?: number;
  timeOnIce?: number;
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
  seasonTotals?: Array<Record<string, unknown>>;
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

/** NHL CDN throttles Node's default UA aggressively; a browser UA avoids it. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export async function fetchJson<T>(url: string, retries = 7): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": BROWSER_UA },
        next: { revalidate: 3600 },
      });
    } catch {
      res = null; // network hiccup — treat like a retryable failure
    }
    const retryable = !res || res.status === 429 || res.status >= 500;
    if (retryable && attempt < retries - 1) {
      // 429s from the stats API need long cooldowns: 5s → 10s → 20s → 40s → 80s → 120s.
      const backoff = Math.min(120_000, 5_000 * 2 ** attempt);
      await new Promise((r) => setTimeout(r, backoff + Math.random() * 2000));
      continue;
    }
    if (!res || !res.ok) {
      throw new Error(`NHL API error ${res?.status ?? "network"}: ${url}`);
    }
    return res.json() as Promise<T>;
  }
  throw new Error(`NHL API failed after retries: ${url}`);
}

export function seasonIdToLabel(seasonId: number): string {
  const s = String(seasonId);
  return `${s.slice(0, 4)}-${s.slice(6, 8)}`;
}

/** Regular season only — omitting gameTypeId aggregates playoffs into totals. */
const REGULAR_SEASON = "%20and%20gameTypeId=2";

export async function fetchSkaterSummaries(
  seasonId: number,
): Promise<RawSkaterSummary[]> {
  const url = `${STATS_BASE}/skater/summary?cayenneExp=seasonId=${seasonId}${REGULAR_SEASON}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterSummary[] }>(url);
  return data.data;
}

export async function fetchSkaterRealtime(
  seasonId: number,
): Promise<RawSkaterRealtime[]> {
  const url = `${STATS_BASE}/skater/realtime?cayenneExp=seasonId=${seasonId}${REGULAR_SEASON}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterRealtime[] }>(url);
  return data.data;
}

export async function fetchSkaterFaceoffs(
  seasonId: number,
): Promise<RawSkaterFaceoffs[]> {
  const url = `${STATS_BASE}/skater/faceoffpercentages?cayenneExp=seasonId=${seasonId}${REGULAR_SEASON}&limit=-1`;
  const data = await fetchJson<{ data: RawSkaterFaceoffs[] }>(url);
  return data.data;
}

export async function fetchSkaterStatReport(
  report: string,
  seasonId: number,
): Promise<Array<Record<string, unknown> & { playerId: number }>> {
  try {
    const url = `${STATS_BASE}/skater/${report}?cayenneExp=seasonId=${seasonId}${REGULAR_SEASON}&limit=-1`;
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
  const url = `${STATS_BASE}/goalie/summary?cayenneExp=seasonId=${seasonId}${REGULAR_SEASON}&limit=-1`;
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
