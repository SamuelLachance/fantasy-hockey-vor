import { ageFromBirthDate, seasonStartDate } from "../age";
import {
  GOALIE_VOLUME_FIELDS,
  boardSkaterGroup,
  type AverageSlotLine,
  type BoardPosition,
  type DraftBoard,
  type DraftBoardPlayer,
  type LeaguePool,
  type UnprojectedPlayer,
} from "../draft/board-types";
import { nhlCodePosition, type NhlRostersFile } from "../nhl-rosters";
import { snakeNhlSeed } from "../snake/league-seed";
import type { SnakeSummaryFile } from "../snake/types";
import type { PlayerProjection, Position } from "../types";
import { matchAdp, type AdpMatchReport, type AdpRow } from "./adp-match";
import {
  applyCategoryVor,
  type CategoryVorOptions,
  type CategoryVorResult,
  type LeaguePoolPlayer,
} from "./category-vor";
import { GOALIE_SAVE_PCT_SKILL_SD } from "./goalie-shrink";
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
  /**
   * Who the NHL lists today (`src/data/nhl-rosters.json`): unprojected
   * players join the pool, projected ones take their current club. Null or
   * absent: neither.
   */
  nhlRosters?: NhlRostersFile | null;
  /** NHL id → Yahoo eligibility (`yahoo-positions.json`), for unprojected players. */
  yahooPositions?: ReadonlyMap<number, Position[]>;
  /** Snake's summary, for the pool's verdicts (the pages' seed covers the board). */
  snake?: Pick<SnakeSummaryFile, "rows" | "nhl"> | null;
}

export interface BuiltBoard {
  board: DraftBoard;
  vor: CategoryVorResult;
  adp: AdpMatchReport;
  /**
   * The board rows in the engine's order, before any hand move (what
   * `check:draft-board` compares the adjusted board's rank slots with).
   */
  enginePlayers: DraftBoardPlayer[];
  /**
   * Adjusted ids nobody projects (skipped; check:draft-board warns on them).
   * A projected player past the board is pulled onto it first, so a move
   * works at any engine rank.
   */
  adjustmentsMissing: number[];
  /** Everyone else (`pool.json`): projected players past the board, then the unprojected. */
  pool: LeaguePool;
  /** Projected players whose club on an NHL roster today differs from players.json's (id → [old, new]). */
  teamChanges: Map<number, [string, string]>;
}

/**
 * How deep the published board (inlined in the pages) goes. 216 players are
 * drafted; 400 by VOR keeps every plausible pick plus a cushion for reaches,
 * and the goalie floor keeps streamer-grade goalies searchable (the
 * 4-start minimum makes managers reach for them late). Everyone past it is
 * in the league's `pool.json`, which the tables fetch (waivers all season).
 */
export const BOARD_DEPTH = 400;
export const BOARD_MIN_GOALIES = 50;

/**
 * Picks a draft of this league makes: teams × rounds (216 for Light the Lamp).
 * A player the market takes inside that range (Fantrax ADP) is a plausible
 * pick whatever the engine thinks of him in this league's categories, so
 * he stays on the board past BOARD_DEPTH at his engine rank, like the
 * goalie floor: the Joueurs tab lists him and the draft helper can mark him
 * when someone takes him (Cole Hutson, ADP 113, engine rank past 400 on 46
 * projected games; Victor Hedman, ADP 108).
 */
export function marketPickLimit(profile: { teams: number; draft: { rounds: number } }): number {
  return profile.teams * profile.draft.rounds;
}

export function isMarketPick(adp: number | undefined, limit: number): boolean {
  return adp !== undefined && Number.isFinite(adp) && adp <= limit;
}

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
 *
 * Ranks are slots, not indexes: the k-th row of the new order takes the
 * k-th smallest engine rank (likewise per position). The board is 1..400
 * with no gap, then the goalie floor, the market picks and any hand-moved
 * player past `BOARD_DEPTH` at their own engine ranks (a goalie at 437 must
 * keep 437 — the pick-availability odds read the rank of a player without
 * ADP).
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
  const rankSlots = players.map((p) => p.rank).sort((a, b) => a - b);
  const out: DraftBoardPlayer[] = order.map((p, i) => {
    const reason = reasons.get(p.id);
    const row: DraftBoardPlayer = { ...p, rank: rankSlots[i]!, posRank: { ...p.posRank } };
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
    const slots = list.map((p) => p.posRank[key]!);
    const stay = list.filter((p) => !reasons.has(p.id));
    const moved = list.filter((p) => reasons.has(p.id)).sort((a, b) => newRank.get(a.id)! - newRank.get(b.id)!);
    for (const m of moved) {
      const at = stay.findIndex((p) => newRank.get(p.id)! > newRank.get(m.id)!);
      stay.splice(at < 0 ? stay.length : at, 0, m);
    }
    stay.forEach((p, i) => {
      p.posRank[key] = slots[i]!;
    });
  }
  return { players: out, missing };
}

export function buildLeagueBoard(inputs: BoardInputs): BuiltBoard {
  const { profile } = inputs;
  const enginePool = leaguePool(inputs.players);
  const vor = applyCategoryVor(profile, enginePool, {
    r2: inputs.r2,
  });
  // Sensitivity of the goalie exchange rate (shown in the method note): the
  // same board with the softer, half-shrunk predictability ratio.
  const altWeight = vor.goalieWeight.leverageRatio * vor.goalieWeight.predictabilityRatioShrunk;
  const alt = applyCategoryVor(profile, enginePool, { r2: inputs.r2, goalieWeight: altWeight });
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

  // The club each player is on today (roster lists only: a prospect list is
  // an organisation, not a club), for display. Never used to drop anyone.
  const currentTeam = new Map<number, string>();
  for (const r of inputs.nhlRosters?.players ?? []) {
    if (r.list === "roster") currentTeam.set(r.id, r.team);
  }
  const teamChanges = new Map<number, [string, string]>();

  let goalies = 0;
  const pickLimit = marketPickLimit(profile);
  // A hand-moved player stays on the board wherever the engine ranks him:
  // moves only reorder the board's own rank slots (the pool keeps its
  // engine ranks), so one past BOARD_DEPTH is pulled on first, his engine
  // slot with him (board + pool ranks stay 1..N).
  const adjustedIds = new Set((inputs.rankAdjustments?.adjustments ?? []).map((a) => a.id));
  const keptIds = new Set<number>();
  for (const p of vor.players) {
    const keep =
      (p.isGoalie && goalies < BOARD_MIN_GOALIES) ||
      p.rank <= BOARD_DEPTH ||
      isMarketPick(adp.matches.get(p.id)?.adp, pickLimit) ||
      adjustedIds.has(p.id);
    if (p.isGoalie) goalies++;
    if (keep) keptIds.add(p.id);
  }

  const toRow = (p: CategoryVorResult["players"][number]): DraftBoardPlayer => {
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
    const team = currentTeam.get(p.id) ?? p.team;
    if (team !== p.team) teamChanges.set(p.id, [p.team, team]);
    return {
      id: p.id,
      name: p.name,
      team,
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
  };
  const enginePlayers: DraftBoardPlayer[] = vor.players.filter((p) => keptIds.has(p.id)).map(toRow);
  // Past the board: engine ranks and position ranks as they are (hand moves
  // only reorder the board's own rank slots, so board + pool stay 1..N).
  const poolPlayers: DraftBoardPlayer[] = vor.players.filter((p) => !keptIds.has(p.id)).map(toRow);
  const unprojected = unprojectedPlayers(inputs, new Set(vor.players.map((p) => p.id)), seasonStart);
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
    goalieSavePctShrink: {
      factor: round(vor.goalieSavePctShrink.factor, 3),
      mean: round(vor.goalieSavePctShrink.mean, 4),
      spread: round(vor.goalieSavePctShrink.spread, 4),
      skillSd: GOALIE_SAVE_PCT_SKILL_SD,
    },
    skaterGroupOffset: groupOffset,
    replacement,
    averageTeam: { slots },
    players,
  };
  const pool: LeaguePool = {
    schema: 1,
    slug: profile.slug,
    projectionsGeneratedAt: inputs.projectionsGeneratedAt,
    rostersFetchedAt: inputs.nhlRosters?.fetchedAt ?? null,
    players: poolPlayers,
    unprojected,
    snake: inputs.snake ? snakeNhlSeed([...poolPlayers, ...unprojected].map((p) => p.id), inputs.snake) : {},
  };
  return { board, vor, adp, enginePlayers, adjustmentsMissing, pool, teamChanges };
}

/**
 * Players the NHL ties to a club with no projection (not in `projected`):
 * rostered players first, then prospect lists, then the rest of the
 * organisations (the search index), each by name. Yahoo eligibility when
 * Yahoo knows him (last season's file), else his NHL position.
 */
function unprojectedPlayers(inputs: BoardInputs, projected: ReadonlySet<number>, seasonStart: Date): UnprojectedPlayer[] {
  const out: UnprojectedPlayer[] = [];
  for (const r of inputs.nhlRosters?.players ?? []) {
    if (projected.has(r.id)) continue;
    const birth = r.birthDate ?? inputs.birthDates.get(r.id) ?? null;
    const age = birth ? ageFromBirthDate(birth, seasonStart) : 0;
    const yahoo = inputs.yahooPositions?.get(r.id);
    out.push({
      id: r.id,
      name: r.name,
      team: r.team,
      pos: yahoo && yahoo.length > 0 ? [...yahoo] : [nhlCodePosition(r.code)],
      age: age > 0 ? age : null,
      noProj: r.list,
    });
  }
  const order = { roster: 0, prospect: 1, org: 2 } as const;
  return out.sort((a, b) => order[a.noProj] - order[b.noProj] || a.name.localeCompare(b.name, "fr-CA") || a.id - b.id);
}

/** `pool.json`, one player per line like the board. */
export function serializePool(pool: LeaguePool): string {
  const { players, unprojected, snake, ...head } = pool;
  const lines = (xs: readonly string[]) => (xs.length ? `\n${xs.join(",\n")}\n` : "");
  const rows = (xs: readonly unknown[]) => lines(xs.map((x) => JSON.stringify(x)));
  const verdicts = lines(Object.entries(snake).map(([id, e]) => `${JSON.stringify(id)}:${JSON.stringify(e)}`));
  return `${JSON.stringify(head).slice(0, -1)},"snake":{${verdicts}},"players":[${rows(players)}],"unprojected":[${rows(unprojected)}]}\n`;
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
