import type { Category, PlayerProjection, Position } from "@/lib/types";
import { rankingsToCsv } from "@/lib/rankings-csv";

export interface BoardExportRow {
  rank: number;
  id: number;
  name: string;
  team: string;
  positions: Position[];
  vor: number;
  edge: number;
  sigma: number | null;
  gamesPlayed: number;
}

export function rankingsToJsonRows(
  players: PlayerProjection[],
  position: Position | "ALL",
): BoardExportRow[] {
  return players.map((p) => ({
    rank: position === "ALL" ? p.rank : (p.positionRank ?? p.rank),
    id: p.id,
    name: p.name,
    team: p.team,
    positions: p.positions,
    vor: Number(p.vor.toFixed(3)),
    edge: p.draftValue ?? 0,
    sigma: p.uncertainty?.total?.sigma ?? null,
    gamesPlayed: p.gamesPlayed,
  }));
}

export function rankingsJsonString(
  players: PlayerProjection[],
  position: Position | "ALL",
): string {
  return `${JSON.stringify(rankingsToJsonRows(players, position), null, 2)}\n`;
}

export function rankingsCsvString(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): string {
  return rankingsToCsv(players, position, categories);
}
