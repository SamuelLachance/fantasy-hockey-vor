/**
 * Pure view logic of the unified player table: the tab's base view,
 * presets, which columns show, what a bookmarked view really does with the
 * data on hand, sorting and pages. Generic over the league kind: filters
 * belong to each spec's `FilterModel`.
 */
import {
  NAME_SORT,
  type ColumnDef,
  type ExtraKind,
  type FilterEnv,
  type PresetDef,
  type ResolvedPreset,
  type SortDir,
  type SortState,
  type TableBase,
  type TableSpec,
  type TableView,
} from "./types";

// ------------------------------------------------------------ columns

export function columnDef<R, Caps, Ctx>(
  spec: { columns: readonly ColumnDef<R, Caps, Ctx>[] },
  key: string,
): ColumnDef<R, Caps, Ctx> | undefined {
  return spec.columns.find((c) => c.key === key);
}

/** The player column always sorts; a column sorts when it has a sort and the data fills it. */
export function sortAvailable<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, key: string, caps: Caps): boolean {
  if (key === NAME_SORT) return true;
  const c = columnDef(spec, key);
  return !!c?.sort && (c.needs?.(caps) ?? true);
}

export function isSortKey<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, key: string | null): key is string {
  return !!key && (key === NAME_SORT || !!columnDef(spec, key)?.sort);
}

/** First click direction: best first. */
export function sortDefaultDir<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, key: string): SortDir {
  if (key === NAME_SORT) return "asc";
  return columnDef(spec, key)?.sort?.defaultDir ?? "desc";
}

export function columnLabel<R, Caps, Ctx>(c: ColumnDef<R, Caps, Ctx>, ctx: Ctx): string {
  return typeof c.label === "function" ? c.label(ctx) : c.label;
}

export function columnTitle<R, Caps, Ctx>(c: ColumnDef<R, Caps, Ctx>, ctx: Ctx): string {
  return typeof c.title === "function" ? c.title(ctx) : c.title;
}

/** Name of a sort in the counter (« trié par Valeur »). */
export function sortLabel<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, key: string, ctx: Ctx): string {
  if (key === NAME_SORT) return "Nom";
  const c = columnDef(spec, key);
  if (!c) return key;
  return c.sort?.label ?? columnLabel(c, ctx);
}

export function sameCols(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

// ------------------------------------------------------------ presets and base

export function resolvePreset<R, F, Caps, Ctx>(
  spec: TableSpec<R, F, Caps, Ctx>,
  preset: PresetDef<F, Caps>,
  caps: Caps,
): ResolvedPreset<F> {
  return {
    id: preset.id,
    label: typeof preset.label === "function" ? preset.label(caps) : preset.label,
    description: typeof preset.description === "function" ? preset.description(caps) : preset.description,
    filters: { ...spec.defaults.filters, ...preset.filters },
    sort: typeof preset.sort === "function" ? preset.sort(caps) : { ...preset.sort },
    cols: preset.cols,
  };
}

export function findPreset<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, id: string | null, caps: Caps): ResolvedPreset<F> | null {
  const p = id ? spec.presets.find((x) => x.id === id) : undefined;
  return p ? resolvePreset(spec, p, caps) : null;
}

/** The view a tab starts from: its preset (or the spec's defaults) at the tab's page size. */
export function tableBase<R, F, Caps, Ctx>(
  spec: TableSpec<R, F, Caps, Ctx>,
  presetId: string | null,
  caps: Caps,
  perPage: number,
): TableBase<F> {
  const p = findPreset(spec, presetId, caps);
  return {
    preset: p?.id ?? null,
    filters: p?.filters ?? { ...spec.defaults.filters },
    sort: p?.sort ?? { ...spec.defaults.sort },
    cols: p?.cols ?? spec.defaults.cols,
    perPage,
  };
}

export function baseView<F>(base: TableBase<F>): TableView<F> {
  return { filters: base.filters, sort: base.sort, cols: null, page: 1, perPage: base.perPage };
}

/**
 * A preset applied to the view: its filters and sort, and its columns when
 * they differ from the tab's (otherwise the tab's defaults, auto-hidden for
 * the view, as before). Back to page 1; the page size stays.
 */
export function applyPreset<F>(view: TableView<F>, preset: ResolvedPreset<F>, base: TableBase<F>): TableView<F> {
  return {
    ...view,
    filters: { ...preset.filters },
    sort: { ...preset.sort },
    cols: sameCols(preset.cols, base.cols) ? null : [...preset.cols],
    page: 1,
  };
}

/** The chip is pressed: same filters and sort (columns are free). */
export function matchesPreset<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: Pick<TableView<F>, "filters" | "sort">, preset: ResolvedPreset<F>): boolean {
  return (
    spec.filterModel.equal(view.filters, preset.filters) &&
    view.sort.key === preset.sort.key &&
    view.sort.dir === preset.sort.dir
  );
}

/** « Réinitialiser »: the tab's filters and sort; chosen columns and page size stay. */
export function resetView<F>(view: TableView<F>, base: TableBase<F>): TableView<F> {
  return { ...baseView(base), cols: view.cols, perPage: view.perPage };
}

/** Nothing to reset: the tab's filters and sort. */
export function atBase<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: TableView<F>, base: TableBase<F>): boolean {
  return (
    spec.filterModel.activeCount(view.filters, base.filters) === 0 &&
    view.sort.key === base.sort.key &&
    view.sort.dir === base.sort.dir
  );
}

// ------------------------------------------------------------ effective view

/**
 * Chosen columns (or the base's) that the data can fill. With the default
 * set, the spec's auto-hidden columns step aside for the view.
 */
export function visibleColumns<R, F, Caps, Ctx>(
  spec: TableSpec<R, F, Caps, Ctx>,
  view: Pick<TableView<F>, "filters" | "cols">,
  base: Pick<TableBase<F>, "cols">,
  caps: Caps,
): string[] {
  const chosen = new Set(view.cols ?? base.cols);
  if (!view.cols && spec.autoHide) for (const c of spec.autoHide(view.filters, caps)) chosen.delete(c);
  return spec.columns.filter((c) => chosen.has(c.key) && (c.needs?.(caps) ?? true)).map((c) => c.key);
}

/**
 * What a view really does with the data on hand. A bookmark can name what
 * this data cannot show (an unknown team, a filter on data that is not
 * published, a sort on a missing column): those fall back here, and the
 * user's URL is left as it was.
 * - filters: the spec's `normalize`;
 * - a sort on an unavailable column → the tab's sort (or the spec's);
 * - a sort on a column auto-hidden for this view (empty for every row it
 *   shows) → the first visible fallback sort, so the header arrow tells
 *   the truth.
 */
export function effectiveView<R, F, Caps, Ctx>(
  spec: TableSpec<R, F, Caps, Ctx>,
  view: TableView<F>,
  base: TableBase<F>,
  env: FilterEnv<Caps, Ctx>,
): { filters: F; sort: SortState; columns: string[] } {
  const filters = spec.filterModel.normalize(view.filters, env);
  const columns = visibleColumns(spec, { filters, cols: view.cols }, base, env.caps);
  const fallback = sortAvailable(spec, base.sort.key, env.caps) ? base.sort : spec.defaults.sort;
  let sort = sortAvailable(spec, view.sort.key, env.caps) ? view.sort : fallback;
  if (!view.cols && sort.key !== NAME_SORT && !columns.includes(sort.key)) {
    const key = (spec.fallbackSorts ?? []).find((k) => columns.includes(k)) ?? NAME_SORT;
    sort = { key, dir: sortDefaultDir(spec, key) };
  }
  return { filters, sort, columns };
}

/** Optional data a view reads (its filters, its sort): rows wait for it. */
export function viewReadsExtras<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: Pick<TableView<F>, "filters" | "sort">): ExtraKind[] {
  const out = new Set<ExtraKind>(spec.filterModel.readsExtras(view.filters));
  const sortExtra = columnDef(spec, view.sort.key)?.readsExtras;
  if (sortExtra) out.add(sortExtra);
  return [...out];
}

// ------------------------------------------------------------ rows

/** The context a view's cells, headers and sorts see (the spec's `viewCtx`, else the data's). */
export function viewContext<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, ctx: Ctx, filters: F): Ctx {
  return spec.viewCtx ? spec.viewCtx(ctx, filters) : ctx;
}

export function filterRows<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, rows: readonly R[], filters: F, ctx: Ctx): R[] {
  return rows.filter((r) => spec.filterModel.test(r, filters, ctx));
}

// Intl.Collator("fr") = localeCompare(…, "fr"), built once (sorting 2 600 names).
const collator = new Intl.Collator("fr");

/** French name order, then the row key (a stable total order). */
export function compareNames<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, a: R, b: R): number {
  const ka = spec.rowKey(a);
  const kb = spec.rowKey(b);
  return collator.compare(spec.nameOf(a), spec.nameOf(b)) || (ka < kb ? -1 : ka > kb ? 1 : 0);
}

const finite = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : x);

/**
 * Stable sort; rows without the sorted number always come last (both
 * directions), then the spec's tie-break. `ctx` is the view's (see
 * `TableSpec.viewCtx`).
 */
export function sortRows<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, rows: readonly R[], sort: SortState, ctx?: Ctx): R[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  if (sort.key === NAME_SORT) return [...rows].sort((a, b) => sign * compareNames(spec, a, b));
  const get = columnDef(spec, sort.key)?.sort?.value;
  if (!get) return [...rows].sort((a, b) => spec.tieBreak(a, b));
  const decorated = rows.map((r) => ({ r, v: finite(get(r, ctx as Ctx)) }));
  decorated.sort((a, b) => {
    const x = a.v;
    const y = b.v;
    if (x === null || y === null) {
      if (x !== y) return x === null ? 1 : -1;
    } else if (x !== y) return sign * (x - y);
    return spec.tieBreak(a.r, b.r);
  });
  return decorated.map((d) => d.r);
}

/** Clicking a header: same column flips, a new one starts at its natural direction. */
export function nextSort<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, current: SortState, key: string): SortState {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: sortDefaultDir(spec, key) };
}

export function pageCount(total: number, perPage: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, perPage)));
}

export function clampPage(page: number, total: number, perPage: number): number {
  return Math.min(Math.max(1, Math.floor(page) || 1), pageCount(total, perPage));
}
