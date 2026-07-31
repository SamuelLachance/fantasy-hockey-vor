import type { Category, PlayerProjection, Position } from "@/lib/types";
import { projectionStatValue } from "@/lib/format";
import { vorForFilter } from "@/lib/rankings-filters";
import { downloadTextFile, rankingsToCsv } from "@/lib/rankings-csv";

export interface BoardExportRow {
  rank: number;
  id: number;
  name: string;
  team: string;
  positions: Position[];
  /** VOR scoped to the export filter position (overall when ALL). */
  vor: number;
  edge: number;
  sigma: number | null;
  gamesPlayed: number;
  /** Category totals for the same columns as CSV export. */
  stats: Partial<Record<Category, number | null>>;
}

export interface RankingsJsonExport {
  exportedAt: string;
  filterPosition: Position | "ALL";
  vorScope: "overall" | "position";
  categories: Category[];
  playerCount: number;
  players: BoardExportRow[];
}

/** Numeric category value for JSON export (savePct rounded like CSV). */
export function exportCategoryStat(
  player: PlayerProjection,
  category: Category,
): number | null {
  const v = projectionStatValue(player, category);
  if (v == null) return null;
  return category === "savePct" ? Number(v.toFixed(4)) : v;
}

export function rankingsToJsonRows(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): BoardExportRow[] {
  return players.map((p) => {
    const stats: Partial<Record<Category, number | null>> = {};
    for (const cat of categories) {
      stats[cat] = exportCategoryStat(p, cat);
    }
    return {
      rank: position === "ALL" ? p.rank : (p.positionRank ?? p.rank),
      id: p.id,
      name: p.name,
      team: p.team,
      positions: p.positions,
      vor: Number(vorForFilter(p, position).toFixed(3)),
      edge: p.draftValue ?? 0,
      sigma: p.uncertainty?.total?.sigma ?? null,
      gamesPlayed: p.gamesPlayed,
      stats,
    };
  });
}

export function rankingsJsonExport(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
  exportedAt = new Date().toISOString(),
): RankingsJsonExport {
  return {
    exportedAt,
    filterPosition: position,
    vorScope: position === "ALL" ? "overall" : "position",
    categories: [...categories],
    playerCount: players.length,
    players: rankingsToJsonRows(players, position, categories),
  };
}

export function rankingsJsonString(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): string {
  return `${JSON.stringify(rankingsJsonExport(players, position, categories), null, 2)}\n`;
}

export function rankingsCsvString(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): string {
  return rankingsToCsv(players, position, categories);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function downloadRankingsCsv(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): void {
  downloadTextFile(
    `vor-rankings-${position.toLowerCase()}-${stamp()}.csv`,
    rankingsCsvString(players, position, categories),
    "text/csv;charset=utf-8",
  );
}

export function downloadRankingsJson(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
): void {
  downloadTextFile(
    `vor-rankings-${position.toLowerCase()}-${stamp()}.json`,
    rankingsJsonString(players, position, categories),
    "application/json;charset=utf-8",
  );
}

export type ExportFlashKind = "idle" | "csv" | "json";

/** Visible label for CSV/JSON export buttons during Saved flash. */
export function exportButtonLabel(
  kind: "csv" | "json",
  flash: ExportFlashKind,
): string {
  if (flash === kind) return "Saved";
  return kind === "csv" ? "CSV" : "JSON";
}

/** Accessible name for the export button group. */
export function exportGroupAriaLabel(): string {
  return "Export filtered rankings";
}

/** Tooltip for an export format button. */
export function exportButtonTitle(kind: "csv" | "json"): string {
  return kind === "csv"
    ? "Download filtered rankings as CSV"
    : "Download filtered rankings as JSON";
}
