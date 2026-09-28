import type { SnakeNhlFile } from "../snake/types";
import type { Position, SkaterCategory } from "../types";
import type {
  LeagueGoalieCategory,
  RosterSlot,
  StartingSlot,
} from "../leagues/types";

/**
 * Published draft board (`public/leagues/<slug>/board.json`). Client-safe:
 * types only, no engine imports. Arrays (`proj`, `z`) are aligned with
 * `categories.skater` for skaters and `categories.goalie` for goalies.
 */

export type BoardPosition = Position | "F";

export interface DraftBoardPlayer {
  id: number;
  name: string;
  team: string;
  /** Yahoo-eligible positions. */
  pos: Position[];
  /** Age on Oct 1 of the season (null when the profile has no birth date). */
  age: number | null;
  gp: number;
  /** Projected category line (display units: GAA and SV% as rates). */
  proj: number[];
  /** Per-category z (soft-capped, before the goalie weight). */
  z: number[];
  /** Goalies only: projected saves and goals against (team GAA / SV%). */
  sv?: number;
  ga?: number;
  value: number;
  vor: number;
  /** Slot his VOR is measured at (best replacement gap). */
  vorPos: Position;
  rank: number;
  posRank: Partial<Record<BoardPosition, number>>;
  /** Fantrax ADP (market proxy); null when unmatched or never drafted. */
  adp: number | null;
  /**
   * Set when a hand adjustment (`src/data/leagues/<slug>/rank-adjustments.json`)
   * moved him: `rank`, `posRank` and `vor` then follow the adjusted order
   * (`vor` bridged between his new neighbours) and the engine's figures
   * stay here.
   */
  adjusted?: BoardRankAdjustment;
  /**
   * Client-side rows only (never in board.json or pool.json's `players`): a
   * player the NHL lists with no projection (`LeaguePool.unprojected`). His
   * `proj` / `z` are empty, `value` / `vor` / `gp` are 0 and not to be
   * shown, and `rank` only orders him after every projected player.
   */
  noProj?: NoProjectionKind;
}

/**
 * Why a listed player has no projection row: on a club's roster, only on
 * its prospect list, or only in its organisation (the NHL's search index
 * ties him to the club: AHL, junior, college, Europe, long-term injured).
 */
export type NoProjectionKind = "roster" | "prospect" | "org";

/** A player the NHL lists today whom the projections never saw (`pool.json`). */
export interface UnprojectedPlayer {
  id: number;
  name: string;
  team: string;
  /** Yahoo eligibility when Yahoo knows him, else his NHL position. */
  pos: Position[];
  age: number | null;
  noProj: NoProjectionKind;
}

/**
 * The rest of a categories league's player pool
 * (`public/leagues/<slug>/pool.json`, written with board.json by
 * `npm run draft:board`): fetched by the tables, never inlined in a page.
 * `players` are the projected players past the board, in the same row shape
 * at their own engine ranks (board and pool ranks together are 1..N with no
 * gap), `unprojected` the players the NHL ties to a club (roster,
 * prospect list or organisation) with no projection, and `snake` Snake's
 * verdicts for the pool's players he discussed (the pages' seed covers the
 * board).
 */
export interface LeaguePool {
  schema: 1;
  slug: string;
  /** Same as the board's `source.projectionsGeneratedAt`. */
  projectionsGeneratedAt: string;
  /** The NHL lists snapshot (`src/data/nhl-rosters.json`); null without one. */
  rostersFetchedAt: string | null;
  players: DraftBoardPlayer[];
  unprojected: UnprojectedPlayer[];
  snake: SnakeNhlFile["rows"];
}

export interface BoardRankAdjustment {
  /** Engine rank before the move. */
  fromRank: number;
  /** Engine VOR before the move. */
  vorModel: number;
  /** Why (French, shown on the site). */
  reason: string;
}

/** The engine's VOR (before any hand adjustment). */
export function modelVor(p: Pick<DraftBoardPlayer, "vor" | "adjusted">): number {
  return p.adjusted ? p.adjusted.vorModel : p.vor;
}

/**
 * Value on the published VOR's scale: `value` moved by the same amount as
 * his VOR, so lineup maths (value − seat replacement) agree with the
 * adjusted rank. `value` itself stays the engine's sum of z.
 */
export function effectiveValue(p: Pick<DraftBoardPlayer, "value" | "vor" | "adjusted">): number {
  return p.adjusted ? p.value + (p.vor - p.adjusted.vorModel) : p.value;
}

export interface AverageSlotLine {
  /** Mean z per category of the players seated at this slot league-wide. */
  z: number[];
  /** Mean projected line per seat (skater cats, or goalie volumes). */
  stats: number[];
}

export interface DraftBoard {
  schema: 1;
  slug: string;
  leagueName: string;
  season: string;
  source: {
    projectionsGeneratedAt: string;
    projectionEngine: string;
    adpSource: string;
    adpFetchedAt: string;
    adpMatched: number;
  };
  league: {
    teams: number;
    rounds: number;
    pickSeconds: number;
    draftStartsAt: string;
    roster: Record<RosterSlot, number>;
    slotEligibility: Record<StartingSlot, Position[]>;
    minGoalieAppearancesPerWeek: number;
    maxAcquisitionsPerWeek: number | null;
  };
  categories: { skater: SkaterCategory[]; goalie: LeagueGoalieCategory[] };
  /** Goalie volume fields carried in `averageTeam.slots.G.stats`. */
  goalieVolumeFields: GoalieVolumeField[];
  goalieWeight: {
    weight: number;
    leverageRatio: number;
    predictabilityRatio: number;
    /** Overall rank of the best goalie, and goalies inside the top 100. */
    firstGoalieRank: number | null;
    goaliesInTop100: number;
    /** Sensitivity: the softer (half-shrunk) predictability discount. */
    alt: {
      weight: number;
      predictabilityRatio: number;
      firstGoalieRank: number | null;
      goaliesInTop100: number;
    };
  };
  /**
   * SV% over-dispersion removed before anybody is valued
   * (`src/lib/leagues/goalie-shrink.ts`): each goalie's projected SV% gap to
   * `mean` is divided by `factor`, shots against and GP held, so the SV%,
   * saves and GAA of this board sit closer to the mean than the shared
   * `players.json` (the main table) shows. `spread` is the projections' SD
   * over workhorse goalies before the shrink, `skillSd` the most that three
   * seasons of history can justify.
   */
  goalieSavePctShrink: { factor: number; mean: number; spread: number; skillSd: number };
  /**
   * Per skater category (aligned with `categories.skater`), the z a group
   * starts from: (group mean − common mean) ÷ SD. z is centred on F and D
   * together so a D and a forward compare for Util; z − offset is the gap to
   * the player's own group (what the per-player bars show).
   */
  skaterGroupOffset: Record<SkaterGroup, number[]>;
  replacement: Partial<Record<Position | "F" | "Util", number>>;
  averageTeam: {
    slots: Partial<Record<StartingSlot, AverageSlotLine>>;
  };
  players: DraftBoardPlayer[];
}

export type GoalieVolumeField = "wins" | "shutouts" | "sv" | "ga" | "gp";
export const GOALIE_VOLUME_FIELDS: readonly GoalieVolumeField[] = [
  "wins",
  "shutouts",
  "sv",
  "ga",
  "gp",
];

export function isGoalieBoardPlayer(p: Pick<DraftBoardPlayer, "pos">): boolean {
  return p.pos.includes("G");
}

export type SkaterGroup = "F" | "D";

/** F/D group from eligibility (the board build asserts it matches the engine). */
export function boardSkaterGroup(p: Pick<DraftBoardPlayer, "pos">): SkaterGroup {
  return p.pos.includes("D") ? "D" : "F";
}

/**
 * Per-category z relative to the player's own group (skaters) — the value
 * the bars draw. Goalies are already measured against goalies.
 */
export function groupRelativeZ(board: Pick<DraftBoard, "skaterGroupOffset">, p: Pick<DraftBoardPlayer, "pos" | "z">): number[] {
  if (isGoalieBoardPlayer(p)) return p.z;
  const offset = board.skaterGroupOffset[boardSkaterGroup(p)];
  return p.z.map((z, i) => Math.round((z - (offset[i] ?? 0)) * 100) / 100);
}
