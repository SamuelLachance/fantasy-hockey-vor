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
