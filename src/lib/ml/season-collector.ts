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
import {
  buildSkaterAdvancedFields,
  mapReportRows,
  mergeAdvancedSkaterFields,
} from "./advanced-stats";
import type { MlDataset, PlayerSeasonRow } from "./types";
import { enrichAllRows, loadOrBuildContextCaches } from "./enrich-rows";
import { buildTeamStyleBySeasonTeam } from "./team-style";
import { applyMoneyPuckSkaterFields, loadMoneyPuckSkaterRegistrySync } from "../moneypuck-skaters";

function finite(n: unknown, fallback = 0): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

function mergeRow(existing: PlayerSeasonRow, incoming: PlayerSeasonRow): PlayerSeasonRow {
  const teams = new Set(`${existing.team},${incoming.team}`.split(",").filter(Boolean));
  const gpA = existing.gamesPlayed;
  const gpB = incoming.gamesPlayed;
  const gp = gpA + gpB;
  const sum = (a: number, b: number) => a + b;
  const wavg = (a: number, b: number) => (a * gpA + b * gpB) / Math.max(1, gpA + gpB);

  return {
    ...existing,
    ...mergeAdvancedSkaterFields(existing, incoming, gpA, gpB),
    team: [...teams].join(","),
    gamesPlayed: gp,
    goals: sum(existing.goals, incoming.goals),
    assists: sum(existing.assists, incoming.assists),
    shots: sum(existing.shots, incoming.shots),
    blocks: sum(existing.blocks, incoming.blocks),
    hits: sum(existing.hits, incoming.hits),
    powerplayPoints: sum(existing.powerplayPoints, incoming.powerplayPoints),
    penaltyMinutes: sum(existing.penaltyMinutes, incoming.penaltyMinutes),
    faceoffWins: sum(existing.faceoffWins, incoming.faceoffWins),
    wins: sum(existing.wins, incoming.wins),
    shutouts: sum(existing.shutouts, incoming.shutouts),
    saves: sum(existing.saves, incoming.saves),
    savePct: wavg(existing.savePct, incoming.savePct),
    teamGoalsForPerGame: existing.teamGoalsForPerGame,
  };
}

async function collectSeason(seasonId: number): Promise<PlayerSeasonRow[]> {
  // Chunked (4 at a time) — a 12-wide burst trips the stats API rate limiter.
  const pause = () => new Promise((r) => setTimeout(r, 700));
  const [skaters, realtime, faceoffs, goalies] = await Promise.all([
    fetchSkaterSummaries(seasonId),
    fetchSkaterRealtime(seasonId),
    fetchSkaterFaceoffs(seasonId),
    fetchGoalieSummaries(seasonId),
  ]);
  await pause();
  const [puckPoss, penalties, timeonice, powerplay] = await Promise.all([
    fetchSkaterStatReport("puckPossessions", seasonId),
    fetchSkaterStatReport("penalties", seasonId),
    fetchSkaterStatReport("timeonice", seasonId),
    fetchSkaterStatReport("powerplay", seasonId),
  ]);
  await pause();
  const [penaltykill, percentages, goalsForAgainst, faceoffwins] = await Promise.all([
    fetchSkaterStatReport("penaltykill", seasonId),
    fetchSkaterStatReport("percentages", seasonId),
    fetchSkaterStatReport("goalsForAgainst", seasonId),
    fetchSkaterStatReport("faceoffwins", seasonId),
  ]);

  const rtMap = new Map(realtime.map((r) => [r.playerId, r]));
  const foMap = new Map(faceoffs.map((f) => [f.playerId, f]));
  const maps = {
    puckPoss: mapReportRows(puckPoss),
    penalties: mapReportRows(penalties),
    timeonice: mapReportRows(timeonice),
    powerplay: mapReportRows(powerplay),
    penaltykill: mapReportRows(penaltykill),
    percentages: mapReportRows(percentages),
    goalsForAgainst: mapReportRows(goalsForAgainst),
    faceoffwins: mapReportRows(faceoffwins),
  };

  const byKey = new Map<string, PlayerSeasonRow>();

  for (const s of skaters) {
    const pos = mapNhlPosition(s.positionCode);
    if (pos === "G") continue;
    const team = s.teamAbbrevs.split(",")[0];
    const rt = rtMap.get(s.playerId);
    const fo = foMap.get(s.playerId);
    const advanced = buildSkaterAdvancedFields(s, rt, fo, maps);
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
      ...advanced,
      wins: 0,
      shutouts: 0,
      saves: 0,
      savePct: 0,
      teamGoalsForPerGame: 2.85,
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
      teamGoalsForPerGame: 2.85,
    };
    const key = `${g.playerId}-${seasonId}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeRow(existing, row) : row);
  }

  const mpRegistry = loadMoneyPuckSkaterRegistrySync();
  const rows = [...byKey.values()];
  if (mpRegistry) {
    for (let i = 0; i < rows.length; i++) {
      rows[i] = applyMoneyPuckSkaterFields(rows[i], mpRegistry);
    }
  }
  return rows;
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
  const teamStyle = buildTeamStyleBySeasonTeam(rows);
  const enriched = enrichAllRows(rows, caches, teamStyle);

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
