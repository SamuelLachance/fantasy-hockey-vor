/**
 * What a kind of league plugs into the unified PlayerTable: its table spec
 * (rows, columns, filters, presets: `@/lib/player-table/types`), the data
 * its hook loads, and the few React pieces only it can draw (its filter
 * form, the name cell, the cells, the details row).
 */
import type { ComponentType, ReactNode } from "react";
import type { TableSpec } from "@/lib/player-table/types";

export type TableStatus = "idle" | "loading" | "ready" | "error";

export interface TableData<R, Caps, Ctx> {
  /** Every row once the source is in (empty before). */
  rows: readonly R[];
  /** Rows the page already has, shown until `status` is ready (and when it fails). */
  fallbackRows?: readonly R[];
  /** When the fallback rows are only part of what the table will list: say so (loading, then failed). */
  fallbackNote?: { loading: string; error: string };
  status: TableStatus;
  /** Optional data in (or not coming): views that read it wait until then. */
  extras: { snake: boolean; dynasty: boolean; snakeFull: boolean };
  caps: Caps;
  ctx: Ctx;
  /** Option lists from the data (phases, verdicts, trends, NHL teams…). */
  labels: Readonly<Record<string, readonly string[]>>;
  /** Players the source holds (header note), when known. */
  total: number | null;
  /** Start loading (idempotent). */
  want(): void;
  /** The « Opinions » column or sort needs the full Snake index. */
  wantFullSnake(): void;
  retry(): void;
}

export interface FilterUiProps<F, Caps, Ctx> {
  /** DOM id prefix of the table. */
  idPrefix: string;
  filters: F;
  caps: Caps;
  ctx: Ctx;
  labels: Readonly<Record<string, readonly string[]>>;
  onFilters(patch: Partial<F>): void;
  /** The table's own buttons (« Colonnes », « Réinitialiser »), placed by the form. */
  actions: ReactNode;
}

export interface CellOut {
  node: ReactNode;
  /** Classes added to the cell's base (alignment, padding, nowrap, numbers). */
  className?: string;
}

export interface NameCellProps<R, Ctx> {
  row: R;
  ctx: Ctx;
  /** The search text (highlighted in the name). */
  query: string;
  /** Visible columns (a column shown under the name on phones). */
  visible: readonly string[];
}

export interface TableAdapter<R, F, Caps, Ctx> {
  spec: TableSpec<R, F, Caps, Ctx>;
  Filters: ComponentType<FilterUiProps<F, Caps, Ctx>>;
  NameCell: ComponentType<NameCellProps<R, Ctx>>;
  cells: Readonly<Record<string, (row: R, ctx: Ctx) => CellOut>>;
  Detail: ComponentType<{ row: R; ctx: Ctx; idPrefix: string }>;
  rowClass?(row: R, ctx: Ctx): string | undefined;
}
