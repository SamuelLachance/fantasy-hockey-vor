import type { Category, PlayerProjection, Position } from "@/lib/types";
import { projectionStatValue } from "@/lib/format";
import {
  isInvertedRangeBound,
  vorForFilter,
  type RangeKey,
  type SortKey,
  type StatRanges,
} from "@/lib/rankings-filters";
import { downloadTextFile, rankingsToCsv } from "@/lib/rankings-csv";

/** Provenance ranges for JSON export — omit empty and inverted bounds. */
export function exportStatRanges(ranges: StatRanges): StatRanges {
  const out: StatRanges = {};
  for (const [key, b] of Object.entries(ranges) as [
    RangeKey,
    { min: string; max: string } | undefined,
  ][]) {
    if (!b) continue;
    if (!b.min?.trim() && !b.max?.trim()) continue;
    if (isInvertedRangeBound(key, b.min, b.max)) continue;
    out[key] = { min: b.min, max: b.max };
  }
  return out;
}

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

/** Live board filter/sort snapshot baked into JSON exports. */
export interface RankingsJsonExportFilters {
  query: string;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  hideDepthGoalies: boolean;
  statRanges: StatRanges;
}

export interface RankingsJsonExport {
  exportedAt: string;
  filterPosition: Position | "ALL";
  vorScope: "overall" | "position";
  categories: Category[];
  filters: RankingsJsonExportFilters;
  playerCount: number;
  players: BoardExportRow[];
}

export interface RankingsExportContext {
  position: Position | "ALL";
  categories: readonly Category[];
  filters: RankingsJsonExportFilters;
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
  ctx: RankingsExportContext,
  exportedAt = new Date().toISOString(),
): RankingsJsonExport {
  const { position, categories, filters } = ctx;
  return {
    exportedAt,
    filterPosition: position,
    vorScope: position === "ALL" ? "overall" : "position",
    categories: [...categories],
    filters: {
      query: filters.query,
      sortKey: filters.sortKey,
      sortDir: filters.sortDir,
      hideDepthGoalies: filters.hideDepthGoalies,
      statRanges: exportStatRanges(filters.statRanges),
    },
    playerCount: players.length,
    players: rankingsToJsonRows(players, position, categories),
  };
}

export function rankingsJsonString(
  players: PlayerProjection[],
  ctx: RankingsExportContext,
): string {
  return `${JSON.stringify(rankingsJsonExport(players, ctx), null, 2)}\n`;
}

export function rankingsCsvString(
  players: PlayerProjection[],
  position: Position | "ALL",
  categories: readonly Category[],
  filters?: RankingsJsonExportFilters,
): string {
  return rankingsToCsv(players, position, categories, filters);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Download basename including position + sort so same-day exports differ. */
export function rankingsExportFilename(
  ctx: RankingsExportContext,
  ext: "csv" | "json",
  date = stamp(),
): string {
  const pos = ctx.position.toLowerCase();
  const sort = `${ctx.filters.sortKey}-${ctx.filters.sortDir}`;
  return `vor-rankings-${pos}-${sort}-${date}.${ext}`;
}

export function downloadRankingsCsv(
  players: PlayerProjection[],
  ctx: RankingsExportContext,
): void {
  downloadTextFile(
    rankingsExportFilename(ctx, "csv"),
    rankingsCsvString(
      players,
      ctx.position,
      ctx.categories,
      ctx.filters,
    ),
    "text/csv;charset=utf-8",
  );
}

export function downloadRankingsJson(
  players: PlayerProjection[],
  ctx: RankingsExportContext,
): void {
  downloadTextFile(
    rankingsExportFilename(ctx, "json"),
    rankingsJsonString(players, ctx),
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
export function exportButtonTitle(
  kind: "csv" | "json",
  opts?: { searchPending?: boolean; empty?: boolean },
): string {
  if (opts?.searchPending) {
    return "Wait for search to finish updating before exporting";
  }
  if (opts?.empty) {
    return "No players to export — clear filters or search";
  }
  return kind === "csv"
    ? "Download filtered rankings as CSV"
    : "Download filtered rankings as JSON";
}

/** Accessible name — keeps CSV/JSON identity during the Saved flash. */
export function exportButtonAriaLabel(
  kind: "csv" | "json",
  opts?: {
    searchPending?: boolean;
    empty?: boolean;
    flash?: ExportFlashKind;
  },
): string {
  if (opts?.searchPending || opts?.empty) {
    return exportButtonTitle(kind, opts);
  }
  if (opts?.flash === kind) {
    return kind === "csv" ? "CSV rankings saved" : "JSON rankings saved";
  }
  return exportButtonTitle(kind, opts);
}
