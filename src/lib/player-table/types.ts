/**
 * The unified player table's model types (no React, no DOM). One generic
 * table renders every league's player lists; each kind of league brings a
 * `TableSpec`: its rows, columns, filters (parse / serialize / test are the
 * adapter's own), presets and default view. Views are bookmarked in the URL
 * as their difference from the tab's base view.
 */

export type SortDir = "asc" | "desc";

export interface SortState {
  /** A sortable column key, or `NAME_SORT` (the player column). */
  key: string;
  dir: SortDir;
}

export interface Range {
  min: number | null;
  max: number | null;
}

export const ANY_RANGE: Range = { min: null, max: null };

/** Sort key of the player (row header) column. */
export const NAME_SORT = "nom";

export interface TableView<F> {
  filters: F;
  sort: SortState;
  /** Chosen columns; null = the base's default columns (auto-hidden for the view). */
  cols: readonly string[] | null;
  page: number;
  perPage: number;
}

/** The view a tab starts from (and « Réinitialiser » returns to). */
export interface TableBase<F> {
  /** Preset the tab starts from (null = the spec's defaults). */
  preset: string | null;
  filters: F;
  sort: SortState;
  /** Default columns while the view names none. */
  cols: readonly string[];
  perPage: number;
}

export interface ColumnDef<R, Caps, Ctx> {
  /** URL-stable ASCII key, no ":" (`valeur`, `z-sog`). */
  key: string;
  /** Short header (« Dispo. au n° 27 »). */
  label: string | ((ctx: Ctx) => string);
  /** Full meaning: header tooltip, column chooser, sort button name. */
  title: string | ((ctx: Ctx) => string);
  align: "left" | "right";
  /** Group label in the column chooser (« Projection », « Snake »…). */
  group: string;
  sort?: {
    /** The sorted number (the view context: see `TableSpec.viewCtx`). */
    value: (r: R, ctx: Ctx) => number | null | undefined;
    defaultDir: SortDir;
    /** Name in the counter's « trié par … » (defaults to the label). */
    label?: string;
  };
  /** Unavailable with this data: hidden from the chooser, ignored in the URL. */
  needs?: (caps: Caps) => boolean;
  /** Choosing or sorting it asks for the full Snake index. */
  lazy?: "snakeFull";
  /** Sorting by it waits for that optional data. */
  readsExtras?: ExtraKind;
  /** Phones show it under the player's name instead (the cell hides below `sm`). */
  mobileUnderName?: boolean;
}

export type ExtraKind = "snake" | "dynasty";

export interface FilterEnv<Caps, Ctx> {
  caps: Caps;
  labels: Readonly<Record<string, readonly string[]>>;
  ctx: Ctx;
}

/** Everything a kind of league knows about its own filters. */
export interface FilterModel<F, R, Caps, Ctx> {
  /** URL keys it owns (others, like `team`, are left alone). */
  params: readonly string[];
  /** A missing param keeps the base value; explicit tokens turn a base setting off. */
  parse(p: URLSearchParams, base: F): F;
  /** Differences from the base only, in a fixed order. */
  serialize(f: F, base: F): Array<[string, string]>;
  /** What this data can apply (an unknown team → everyone, a label the data lacks → off…). */
  normalize(f: F, env: FilterEnv<Caps, Ctx>): F;
  /** Row test, text query included. */
  test(row: R, f: F, ctx: Ctx): boolean;
  /** Filters set beyond the base (the « Réinitialiser » badge). */
  activeCount(f: F, base: F): number;
  /** Optional data these filters read (rows wait for it). */
  readsExtras(f: F): readonly ExtraKind[];
  query(f: F): string;
  withQuery(f: F, q: string): F;
  equal(a: F, b: F): boolean;
}

export interface PresetDef<F, Caps> {
  /** Named by `?vue=`. */
  id: string;
  label: string | ((caps: Caps) => string);
  description: string | ((caps: Caps) => string);
  /** Over the spec's default filters. */
  filters: Partial<F>;
  sort: SortState | ((caps: Caps) => SortState);
  /** Its default columns. */
  cols: readonly string[];
}

/** A preset with the data on hand applied (labels, sort). */
export interface ResolvedPreset<F> {
  id: string;
  label: string;
  description: string;
  filters: F;
  sort: SortState;
  cols: readonly string[];
}

export interface TableSpec<R, F, Caps, Ctx> {
  id: string;
  rowKey(r: R): string;
  nameOf(r: R): string;
  columns: readonly ColumnDef<R, Caps, Ctx>[];
  filterModel: FilterModel<F, R, Caps, Ctx>;
  presets: readonly PresetDef<F, Caps>[];
  defaults: { filters: F; sort: SortState; cols: readonly string[] };
  /**
   * Default columns that step aside for a view (only while it names no
   * columns): always empty or the same for every row it shows.
   */
  autoHide?(filters: F, caps: Caps): readonly string[];
  /** Sorts that stand in, in order, when the view's sort column was auto-hidden. */
  fallbackSorts?: readonly string[];
  /** Ties after the sorted value. */
  tieBreak(a: R, b: R): number;
  /**
   * The context cells, headers and sorts see for a view (e.g. ranks by the
   * filtered position). Must return the same object for the same inputs
   * and view settings it reads, so memoized rows stay put while typing.
   */
  viewCtx?(ctx: Ctx, filters: F): Ctx;
  perPageOptions: readonly number[];
}
