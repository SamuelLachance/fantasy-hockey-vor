/**
 * Subsets of the Fantrax payloads the tool reads. Only fields we use are
 * typed; everything else is left off so a Fantrax-side addition never breaks
 * the build.
 *
 * fxea = `https://www.fantrax.com/fxea/general/<method>` (public Beta API,
 * CORS `*`, callable from the browser).
 * fxpa = `POST https://www.fantrax.com/fxpa/req?leagueId=` (the website's
 * internal API; no CORS, so build-time only; unauthenticated reads only).
 */

/** Fantrax timestamps look like `2026-09-30T19:29:59.0-0400`. */
export type FantraxDateString = string;

export interface FxeaPeriod {
  number: number;
  startDate: FantraxDateString;
  endDate: FantraxDateString;
}

export interface FxeaScoringConfig {
  position: { code: string; id: string; shortName: string };
  scoringCategory: { code: string; id: string; name: string; shortName: string };
  points: number;
}

export interface FxeaScoringGroup {
  group: { code: string; id: string; shortName: string };
  configs: FxeaScoringConfig[];
}

export interface FxeaLeagueInfo {
  leagueName: string;
  seasonYear: number;
  startDate: string;
  endDate: string;
  draftType?: string;
  rosterInfo: {
    positionConstraints: Record<string, { maxActive: number }>;
    maxTotalPlayers: number;
    maxTotalActivePlayers: number;
    maxTotalReservePlayers: number;
  };
  rosterPeriods: FxeaPeriod[];
  scoringPeriods: FxeaPeriod[];
  teamInfo: Record<string, { name: string; id: string }>;
  /** status: FA (free agent), WW (on waivers), T (on a team). */
  playerInfo: Record<string, { eligiblePos: string; status: string }>;
  scoringSystem: { scoringCategorySettings: FxeaScoringGroup[] };
  matchups?: Array<{ period: number; matchupList: unknown[] }>;
  playoffs?: {
    lastRegularSeasonPeriod: number;
    numPlayoffTeams: number;
    firstPlayoffPeriod: number;
  };
}

/** Roster status as fxea spells it. */
export type FxeaRosterStatus = "ACTIVE" | "RESERVE" | "INJURED_RESERVE" | "MINORS";

export interface FxeaRosterItem {
  id: string;
  /** Lineup slot for ACTIVE players (C / W / F / D / Skt / G). */
  position: string;
  status: FxeaRosterStatus | string;
}

export interface FxeaTeamRosters {
  period: number;
  rosters: Record<string, { teamName: string; rosterItems: FxeaRosterItem[] }>;
}

export interface FxeaDraftPick {
  round: number;
  /** Overall pick number (1-based). */
  pick: number;
  pickInRound: number;
  teamId: string;
  /** Epoch ms; placeholder value for picks not yet made. */
  time: number;
  /** Present once the pick is made. */
  playerId?: string;
}

export interface FxeaDraftResults {
  draftDate?: FantraxDateString;
  draftState: string;
  draftType?: string;
  startDate?: FantraxDateString;
  draftOrder?: string[];
  draftPicks: FxeaDraftPick[];
}

export interface FxeaStandingsRow {
  teamId: string;
  teamName: string;
  rank: number;
  points: string;
  totalPointsFor: number;
  winPercentage: number;
  gamesBack: number;
}

/** `getPlayerIds?sport=NHL`: fantraxId → identity (no NHL id). */
export type FxeaPlayerIds = Record<
  string,
  { fantraxId: string; name: string; team?: string; position?: string }
>;

export interface FxeaAdpRow {
  id: string;
  name: string;
  pos: string;
  ADP: number;
}

// ---------------------------------------------------------------- fxpa

export interface FxpaMessage {
  method: string;
  data: Record<string, string | number | boolean>;
}

export interface FxpaEnvelope {
  pageError?: { code?: string; title?: string; text?: string };
  responses?: Array<{ data?: unknown; pageError?: { code?: string } }>;
}

export interface FxpaCell {
  content?: string;
  toolTip?: string;
  teamId?: string;
}

export interface FxpaScorer {
  scorerId: string;
  name: string;
  teamShortName?: string;
  posShortNames?: string;
  rookie?: boolean;
  minorsEligible?: boolean;
  /** "4" = FA, "5" = WW on ALL_AVAILABLE rows. */
  statusId?: string;
  icons?: Array<{ typeId: string; tooltip?: string }>;
}

export interface FxpaPlayerStatsData {
  statsTable: Array<{ scorer: FxpaScorer; cells: FxpaCell[] }>;
  tableHeader: { cells: Array<{ shortName?: string; key?: string; name?: string }> };
  paginatedResultSet?: { totalNumResults: number; totalNumPages: number };
  displayedSelections?: {
    displayedSeasonOrProjection?: { code?: string; timeframeTypeCode?: string };
  };
}

export interface FxpaTeamRosterInfoData {
  scMinMaxData?: {
    tableData: Array<{ scoringCategory: string; total: string; max: string; min: string }>;
  };
  displayedSelections?: { displayedScoringPeriod?: number; displayedFantasyTeamId?: string };
}

export interface FxpaTransactionRow {
  scorer?: FxpaScorer;
  transactionCode: string;
  executed?: boolean;
  deleted?: boolean;
  cells: Array<FxpaCell & { key?: string; icon?: string }>;
}

export interface FxpaTransactionHistoryData {
  table?: { rows: FxpaTransactionRow[] };
}

// ------------------------------------------------------------- NHL api-web

export interface NhlScheduleGame {
  id: number;
  gameType: number;
  startTimeUTC: string;
  awayTeam: { abbrev: string };
  homeTeam: { abbrev: string };
}

export interface NhlScheduleWeek {
  nextStartDate?: string;
  regularSeasonStartDate?: string;
  regularSeasonEndDate?: string;
  gameWeek: Array<{ date: string; games: NhlScheduleGame[] }>;
}
