import {
  computeFaceoffWins,
  fetchGoalieSummaries,
  fetchSkaterFaceoffs,
  fetchSkaterRealtime,
  fetchSkaterStatReport,
  fetchSkaterSummaries,
  HISTORICAL_SEASON_IDS,
  mapNhlPosition,
} from "../nhl-api";
import type { Position } from "../types";
import type { MlDataset, PlayerSeasonRow } from "./types";
import { enrichAllRows, loadOrBuildContextCaches } from "./enrich-rows";

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function mergeRow(existing: PlayerSeasonRow, incoming: PlayerSeasonRow): PlayerSeasonRow {
  const teams = new Set(`${existing.team},${incoming.team}`.split(",").filter(Boolean));
  const gp = existing.gamesPlayed + incoming.gamesPlayed;
  const blend = (a: number, b: number, gpA: number, gpB: number, sum = false) =>
    sum ? a + b : (a * gpA + b * gpB) / Math.max(1, gpA + gpB);

  return {
    ...existing,
    team: [...teams].join(","),
    gamesPlayed: gp,
    goals: existing.goals + incoming.goals,
    assists: existing.assists + incoming.assists,
    shots: existing.shots + incoming.shots,
    blocks: existing.blocks + incoming.blocks,
    hits: existing.hits + incoming.hits,
    powerplayPoints: existing.powerplayPoints + incoming.powerplayPoints,
    penaltyMinutes: existing.penaltyMinutes + incoming.penaltyMinutes,
    faceoffWins: existing.faceoffWins + incoming.faceoffWins,
    wins: existing.wins + incoming.wins,
    shutouts: existing.shutouts + incoming.shutouts,
    saves: existing.saves + incoming.saves,
    savePct: blend(existing.savePct, incoming.savePct, existing.gamesPlayed, incoming.gamesPlayed),
    teamGoalsForPerGame: existing.teamGoalsForPerGame,
  };
}

async function collectSeason(seasonId: number): Promise<PlayerSeasonRow[]> {
  const [skaters, realtime, faceoffs, goalies, puckPoss, penalties] =
    await Promise.all([
      fetchSkaterSummaries(seasonId),
      fetchSkaterRealtime(seasonId),
      fetchSkaterFaceoffs(seasonId),
      fetchGoalieSummaries(seasonId),
      fetchSkaterStatReport("puckPossessions", seasonId),
      fetchSkaterStatReport("penalties", seasonId),
    ]);

  const rtMap = new Map(realtime.map((r) => [r.playerId, r]));
  const foMap = new Map(faceoffs.map((f) => [f.playerId, f]));
  const ppMap = new Map(puckPoss.map((p) => [p.playerId, p]));

  const teamGoals = new Map<string, number>();
  const teamGp = new Map<string, number>();
  for (const s of skaters) {
    const team = s.teamAbbrevs.split(",")[0];
    teamGoals.set(team, (teamGoals.get(team) ?? 0) + finite(s.goals));
    teamGp.set(team, (teamGp.get(team) ?? 0) + finite(s.gamesPlayed));
  }

  const byKey = new Map<string, PlayerSeasonRow>();

  for (const s of skaters) {
    const pos = mapNhlPosition(s.positionCode);
    if (pos === "G") continue;
    const team = s.teamAbbrevs.split(",")[0];
    const rt = rtMap.get(s.playerId);
    const fo = foMap.get(s.playerId);
    const row: PlayerSeasonRow = {
      playerId: s.playerId,
      name: s.skaterFullName,
      seasonId,
      team,
      position: pos,
      isGoalie: false,
      gamesPlayed: finite(s.gamesPlayed),
      goals: finite(s.goals),
      assists: finite(s.assists),
      shots: finite(s.shots),
      blocks: finite(rt?.blockedShots),
      hits: finite(rt?.hits),
      powerplayPoints: finite(s.ppPoints),
      penaltyMinutes: finite(s.penaltyMinutes),
      faceoffWins: computeFaceoffWins(
        fo?.totalFaceoffs ?? 0,
        fo?.faceoffWinPct ?? s.faceoffWinPct,
      ),
      wins: 0,
      shutouts: 0,
      saves: 0,
      savePct: 0,
      teamGoalsForPerGame:
        (teamGoals.get(team) ?? 0) / Math.max(1, teamGp.get(team) ?? 1),
    };
    const key = `${s.playerId}-${seasonId}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeRow(existing, row) : row);
  }

  for (const g of goalies) {
    const team = g.teamAbbrevs.split(",")[0];
    const row: PlayerSeasonRow = {
      playerId: g.playerId,
      name: g.goalieFullName,
      seasonId,
      team,
      position: "G",
      isGoalie: true,
      gamesPlayed: finite(g.gamesPlayed),
      goals: 0,
      assists: 0,
      shots: 0,
      blocks: 0,
      hits: 0,
      powerplayPoints: 0,
      penaltyMinutes: 0,
      faceoffWins: 0,
      wins: finite(g.wins),
      shutouts: finite(g.shutouts),
      saves: finite(g.saves),
      savePct: finite(g.savePct) > 1 ? finite(g.savePct) / 100 : finite(g.savePct),
      teamGoalsForPerGame:
        (teamGoals.get(team) ?? 0) / Math.max(1, teamGp.get(team) ?? 1),
    };
    const key = `${g.playerId}-${seasonId}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeRow(existing, row) : row);
  }

  return [...byKey.values()];
}

export async function buildMlDataset(
  onProgress?: (seasonId: number, index: number, total: number) => void,
): Promise<MlDataset> {
  const rows: PlayerSeasonRow[] = [];
  const seasonIds = [...HISTORICAL_SEASON_IDS];

  for (let i = 0; i < seasonIds.length; i++) {
    const seasonId = seasonIds[i];
    onProgress?.(seasonId, i + 1, seasonIds.length);
    const seasonRows = await collectSeason(seasonId);
    rows.push(...seasonRows);
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`Enriching ${rows.length} player-seasons with bio, contract, team ELO, coach...`);
  const caches = await loadOrBuildContextCaches(rows);
  const enriched = enrichAllRows(rows, caches);

  return {
    builtAt: new Date().toISOString(),
    seasonIds,
    rows: enriched,
  };
}

export function indexRowsByPlayer(
  rows: PlayerSeasonRow[],
): Map<number, PlayerSeasonRow[]> {
  const map = new Map<number, PlayerSeasonRow[]>();
  for (const row of rows) {
    const list = map.get(row.playerId) ?? [];
    list.push(row);
    map.set(row.playerId, list);
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.seasonId - b.seasonId);
  }
  return map;
}

export function positionCode(position: Position): number[] {
  return [
    position === "C" ? 1 : 0,
    position === "LW" ? 1 : 0,
    position === "RW" ? 1 : 0,
    position === "D" ? 1 : 0,
  ];
}
