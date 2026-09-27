import { ageFromBirthDate, seasonStartDate } from "../age";
import {
  GOALIE_VOLUME_FIELDS,
  boardSkaterGroup,
  type AverageSlotLine,
  type BoardPosition,
  type DraftBoard,
  type DraftBoardPlayer,
} from "../draft/board-types";
import type { PlayerProjection, Position } from "../types";
import { matchAdp, type AdpMatchReport, type AdpRow } from "./adp-match";
import {
  applyCategoryVor,
  type CategoryVorOptions,
  type CategoryVorResult,
  type LeaguePoolPlayer,
} from "./category-vor";
import { applyRankAdjustments, bridgeValues, type RankAdjustmentsFile } from "./rank-adjustments";
import type { CategoryLeagueProfile, LeagueCategory, StartingSlot } from "./types";

export interface BoardInputs {
  profile: CategoryLeagueProfile;
  /** Board rows of the main dataset (`players.json`). */
  players: PlayerProjection[];
  projectionsGeneratedAt: string;
  projectionEngine: string;
  /** Holdout R² per category (main dataset `categoryWeights`). */
  r2: CategoryVorOptions["r2"];
  /** NHL id → birth date (YYYY-MM-DD) from `player-profiles.json`. */
  birthDates: Map<number, string>;
  adp: { source: string; fetchedAt: string; rows: AdpRow[] };
  /** Hand rank moves of this league (`rank-adjustments.json`), null when none. */
  rankAdjustments: RankAdjustmentsFile | null;
}

export interface BuiltBoard {
  board: DraftBoard;
  vor: CategoryVorResult;
  adp: AdpMatchReport;
  /** Adjusted ids that are not on the board (skipped; check:draft-board fails on them). */
  adjustmentsMissing: number[];
}

/**
 * How deep the published board goes. 216 players are drafted; 400 by VOR
 * keeps every plausible pick plus a cushion for reaches, and the goalie floor
 * keeps streamer-grade goalies searchable (the 4-start minimum makes managers
 * reach for them late).
 */
export const BOARD_DEPTH = 400;
export const BOARD_MIN_GOALIES = 50;

function round(x: number, digits: number): number {
  if (!Number.isFinite(x)) return 0;
  const f = 10 ** digits;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

/** Display precision per category: rates need more digits than counts. */
function statDigits(cat: LeagueCategory): number {
  if (cat === "savePct") return 4;
  if (cat === "goalsAgainstAverage") return 2;
  return 1;
}

/**
 * Pool fed to the category engine: the main board's projections with the
 * VOR-slot `position` swapped back to the position the projection was built
 * at, so F/D grouping never depends on the *other* league's best slot.
 */
export function leaguePool(players: PlayerProjection[]): LeaguePoolPlayer[] {
  return players.map((p) => ({
    id: p.id,
    name: p.name,
    team: p.team,
    position: p.primaryPosition ?? p.position,
    primaryPosition: p.primaryPosition ?? p.position,
    positions: p.positions,
    isGoalie: p.isGoalie,
    gamesPlayed: p.gamesPlayed,
    projection: p.projection,
  }));
}

/**
 * ADP rows are only trusted as a market signal inside the range a Fantrax
 * draft actually reaches; ≥ 285 is the "picked in one draft out of many"
 * tail where the aggregate saturates.
 */
export const ADP_CEILING = 285;

/** Best goalie's rank and goalies inside the top 100 of an ordered list (rank = index + 1). */
function goalieRankSummary(order: readonly { isGoalie: boolean }[]): { firstGoalieRank: number | null; goaliesInTop100: number } {
  const ranks = order.flatMap((p, i) => (p.isGoalie ? [i + 1] : []));
  return {
    firstGoalieRank: ranks[0] ?? null,
    goaliesInTop100: ranks.filter((r) => r <= 100).length,
  };
}

const RANK_KEYS: readonly BoardPosition[] = ["C", "LW", "RW", "F", "D", "G"];

/**
 * The board in the hand-adjusted order (see `rank-adjustments.ts`): `rank`
 * is the new place; an adjusted row's `vor` is bridged between its new
 * neighbours (so every VOR sort agrees with the rank) and it carries
 * `adjusted` with the engine's rank and VOR. Position ranks follow too:
 * each position's own engine order with the adjusted rows taken out and put
 * back in front of the first player the new overall order puts after them.
 */
export function adjustBoardPlayers(
  players: readonly DraftBoardPlayer[],
  file: RankAdjustmentsFile | null,
): { players: DraftBoardPlayer[]; missing: number[] } {
  if (!file || file.adjustments.length === 0) return { players: [...players], missing: [] };
  const { order, missing } = applyRankAdjustments(players, file.adjustments, (p) => p.id);
  const reasons = new Map(file.adjustments.map((a) => [a.id, a.reason]));
  const isAdjusted = order.map((p) => reasons.has(p.id));
  const vor = bridgeValues(
    order.map((p) => p.vor),
    isAdjusted,
  );
  const out: DraftBoardPlayer[] = order.map((p, i) => {
    const reason = reasons.get(p.id);
    const row: DraftBoardPlayer = { ...p, rank: i + 1, posRank: { ...p.posRank } };
    if (reason === undefined) return row;
    return {
      ...row,
      vor: round(vor[i]!, 2),
      adjusted: { fromRank: p.rank, vorModel: p.vor, reason },
    };
  });

  const newRank = new Map(out.map((p) => [p.id, p.rank]));
  for (const key of RANK_KEYS) {
    const list = out
      .filter((p) => p.posRank[key] != null)
      .sort((a, b) => a.posRank[key]! - b.posRank[key]!);
    const stay = list.filter((p) => !reasons.has(p.id));
    const moved = list.filter((p) => reasons.has(p.id)).sort((a, b) => newRank.get(a.id)! - newRank.get(b.id)!);
    for (const m of moved) {
      const at = stay.findIndex((p) => newRank.get(p.id)! > newRank.get(m.id)!);
      stay.splice(at < 0 ? stay.length : at, 0, m);
    }
    stay.forEach((p, i) => {
      p.posRank[key] = i + 1;
    });
  }
  return { players: out, missing };
}

export function buildLeagueBoard(inputs: BoardInputs): BuiltBoard {
  const { profile } = inputs;
  const pool = leaguePool(inputs.players);
  const vor = applyCategoryVor(profile, pool, {
    r2: inputs.r2,
  });
  // Sensitivity of the goalie exchange rate (shown in the method note): the
  // same board with the softer, half-shrunk predictability ratio.
  const altWeight = vor.goalieWeight.leverageRatio * vor.goalieWeight.predictabilityRatioShrunk;
  const alt = applyCategoryVor(profile, pool, { r2: inputs.r2, goalieWeight: altWeight });
  const adp = matchAdp(
    vor.players.map((p) => ({
      id: p.id,
      name: p.name,
      positions: p.positions,
      isGoalie: p.isGoalie,
    })),
    inputs.adp.rows,
  );

  const seasonStart = seasonStartDate(profile.season);
  const skaterCats = profile.categories.skater;
  const goalieCats = profile.categories.goalie;

  let goalies = 0;
  const kept = vor.players.filter((p) => {
    if (p.isGoalie && goalies < BOARD_MIN_GOALIES) {
      goalies++;
      return true;
    }
    if (p.isGoalie) goalies++;
    return p.rank <= BOARD_DEPTH;
  });

  const enginePlayers: DraftBoardPlayer[] = kept.map((p) => {
    const cats: LeagueCategory[] = p.isGoalie ? goalieCats : skaterCats;
    // The client derives F/D from eligibility (for the group-relative bars);
    // it must agree with the engine's primary-position grouping.
    if (!p.isGoalie && boardSkaterGroup({ pos: p.positions }) !== p.group) {
      throw new Error(`${p.name}: eligibility ${p.positions.join("/")} disagrees with group ${p.group}`);
    }
    const birth = inputs.birthDates.get(p.id);
    const age = birth ? ageFromBirthDate(birth, seasonStart) : 0;
    const m = adp.matches.get(p.id);
    const posRank: DraftBoardPlayer["posRank"] = {};
    for (const [k, v] of Object.entries(p.positionRanks)) {
      if (k === "F" || (p.positions as string[]).includes(k)) {
        posRank[k as Position | "F"] = v;
      }
    }
    return {
      id: p.id,
      name: p.name,
      team: p.team,
      pos: p.positions,
      age: age > 0 ? age : null,
      gp: Math.round(p.gamesPlayed),
      proj: cats.map((c) => round(p.stats[c] ?? 0, statDigits(c))),
      z: cats.map((c) => round(p.z[c] ?? 0, 2)),
      ...(p.goalieRaw
        ? { sv: Math.round(p.goalieRaw.saves), ga: round(p.goalieRaw.goalsAgainst, 1) }
        : {}),
      value: round(p.value, 2),
      vor: round(p.vor, 2),
      vorPos: p.vorPosition,
      rank: p.rank,
      posRank,
      adp: m && m.adp < ADP_CEILING ? round(m.adp, 1) : null,
    };
  });
  // Hand moves last: every reader of the board (tables, draft helper,
  // suggestions, the Yahoo export) follows the adjusted rank.
  const { players, missing: adjustmentsMissing } = adjustBoardPlayers(enginePlayers, inputs.rankAdjustments);
  const goalieIds = new Set(vor.players.filter((p) => p.isGoalie).map((p) => p.id));
  const adjustedOrder = (list: readonly { id: number; isGoalie: boolean }[]) =>
    inputs.rankAdjustments
      ? applyRankAdjustments(list, inputs.rankAdjustments.adjustments, (p) => p.id).order
      : [...list];

  const slots: DraftBoard["averageTeam"]["slots"] = {};
  for (const [slot, zByCat] of Object.entries(vor.averageTeam.slotZ) as [
    StartingSlot,
    Partial<Record<LeagueCategory, number>>,
  ][]) {
    const stats = vor.averageTeam.slotStats[slot] ?? {};
    const isG = slot === "G";
    const line: AverageSlotLine = {
      z: (isG ? goalieCats : skaterCats).map((c) => round(zByCat[c] ?? 0, 3)),
      stats: isG
        ? GOALIE_VOLUME_FIELDS.map((f) =>
            round(
              stats[
                ({ wins: "wins", shutouts: "shutouts", sv: "saves", ga: "goalsAgainst", gp: "gamesPlayed" } as const)[f]
              ] ?? 0,
              2,
            ),
          )
        : skaterCats.map((c) => round(stats[c] ?? 0, 2)),
    };
    slots[slot] = line;
  }

  const groupOffset: DraftBoard["skaterGroupOffset"] = { F: [], D: [] };
  for (const g of ["F", "D"] as const) {
    groupOffset[g] = skaterCats.map((c) => {
      const s = vor.scales.skater[c];
      return s ? round((s.groupMeans[g] - s.mean) / s.sd, 3) : 0;
    });
  }

  const replacement: DraftBoard["replacement"] = {};
  for (const [k, v] of Object.entries(vor.replacementLevels)) {
    replacement[k as keyof DraftBoard["replacement"]] = round(v ?? 0, 3);
  }

  const board: DraftBoard = {
    schema: 1,
    slug: profile.slug,
    leagueName: profile.name,
    season: profile.season,
    source: {
      projectionsGeneratedAt: inputs.projectionsGeneratedAt,
      projectionEngine: inputs.projectionEngine,
      adpSource: inputs.adp.source,
      adpFetchedAt: inputs.adp.fetchedAt,
      adpMatched: players.filter((p) => p.adp != null).length,
    },
    league: {
      teams: profile.teams,
      rounds: profile.draft.rounds,
      pickSeconds: profile.draft.pickSeconds,
      draftStartsAt: profile.draft.startsAt,
      roster: profile.roster,
      slotEligibility: profile.slotEligibility,
      minGoalieAppearancesPerWeek: profile.minGoalieAppearancesPerWeek,
      maxAcquisitionsPerWeek: profile.maxAcquisitionsPerWeek,
    },
    categories: { skater: skaterCats, goalie: goalieCats },
    goalieVolumeFields: [...GOALIE_VOLUME_FIELDS],
    goalieWeight: {
      weight: round(vor.goalieWeight.weight, 4),
      leverageRatio: round(vor.goalieWeight.leverageRatio, 4),
      predictabilityRatio: round(vor.goalieWeight.predictabilityRatio, 4),
      ...goalieRankSummary(players.map((p) => ({ isGoalie: goalieIds.has(p.id) }))),
      // The sensitivity run gets the same hand moves (apples to apples).
      alt: {
        weight: round(altWeight, 4),
        predictabilityRatio: round(vor.goalieWeight.predictabilityRatioShrunk, 4),
        ...goalieRankSummary(adjustedOrder(alt.players)),
      },
    },
    skaterGroupOffset: groupOffset,
    replacement,
    averageTeam: { slots },
    players,
  };
  return { board, vor, adp, adjustmentsMissing };
}

/**
 * Stable, compact serialisation: one player per line so a regenerated board
 * diffs row by row.
 */
export function serializeBoard(board: DraftBoard): string {
  const { players, ...head } = board;
  const headJson = JSON.stringify(head);
  const rows = players.map((p) => JSON.stringify(p)).join(",\n");
  return `${headJson.slice(0, -1)},"players":[\n${rows}\n]}\n`;
}
