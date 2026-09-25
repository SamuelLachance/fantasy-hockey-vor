/**
 * The player table's view in the address bar. Params spell the difference
 * from the tab's base view, so a clean tab URL shows the tab's default and
 * a bookmark keeps working when the base is on. Other params (`team`) and
 * the hash stay in place; invalid values fall back silently.
 *
 * Param names are the old /league explorer's (`q`, `pos`, `statut`, …,
 * `tri`, `ordre`, `cols`, `page`, `par`, `vue`): on a tab whose base is
 * the explorer's default view, its bookmarks read the same.
 */
import { isSortKey, sameCols, sortDefaultDir } from "./model";
import { ANY_RANGE, type Range, type TableBase, type TableSpec, type TableView } from "./types";

/** A preset by name (links from other panels and tabs): resolved once the data is in. */
export const PRESET_PARAM = "vue";
/** A player to open (`?joueur=<rowKey>`): searched, expanded, then dropped from the URL. */
export const FOCUS_PARAM = "joueur";
const VIEW_PARAMS = ["tri", "ordre", "cols", "page", "par"] as const;

/** Every key the table owns in the query string. */
export function ownedParams<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>): string[] {
  return [...spec.filterModel.params, ...VIEW_PARAMS, PRESET_PARAM, FOCUS_PARAM];
}

const toParams = (search: string | URLSearchParams) =>
  typeof search === "string" ? new URLSearchParams(search) : search;

// ------------------------------------------------------------ ranges

function fmtBound(x: number | null): string {
  if (x === null || !Number.isFinite(x)) return "";
  return String(Math.round(x * 100) / 100);
}

/** `{ min: 18, max: 21 }` → `18-21`; `18-`, `-21`; "" when open. */
export function encodeRange(r: Range): string {
  if (r.min === null && r.max === null) return "";
  return `${fmtBound(r.min)}-${fmtBound(r.max)}`;
}

/** Inverse of `encodeRange`; a lone number is an exact value; `-` is open. Garbage → open. */
export function decodeRange(s: string | null): Range {
  return (s ? parseRange(s) : null) ?? ANY_RANGE;
}

function parseRange(s: string): Range | null {
  const one = /^\d+(?:\.\d+)?$/.test(s) ? Number(s) : null;
  if (one !== null) return { min: one, max: one };
  const m = /^(\d+(?:\.\d+)?)?-(\d+(?:\.\d+)?)?$/.exec(s.trim());
  if (!m) return null;
  const min = m[1] !== undefined ? Number(m[1]) : null;
  const max = m[2] !== undefined ? Number(m[2]) : null;
  if (min !== null && max !== null && min > max) return { min: max, max: min };
  return { min, max };
}

export const sameRange = (a: Range, b: Range) => a.min === b.min && a.max === b.max;

/** A range param: missing → the base's; `-` → open (the off token); garbage → the base's. */
export function readRange(params: URLSearchParams, key: string, base: Range): Range {
  const s = params.get(key);
  if (s === null) return base;
  return parseRange(s) ?? base;
}

/** A range that differs from the base: `18-21`, or `-` when the base has a bound and this one is open. */
export function writeRange(out: Array<[string, string]>, key: string, r: Range, base: Range): void {
  if (sameRange(r, base)) return;
  out.push([key, encodeRange(r) || "-"]);
}

/** An on/off param: missing → the base's; `1` on, `0` off; anything else → the base's. */
export function readFlag(params: URLSearchParams, key: string, base: boolean): boolean {
  const s = params.get(key);
  return s === "1" ? true : s === "0" ? false : base;
}

export function writeFlag(out: Array<[string, string]>, key: string, v: boolean, base: boolean): void {
  if (v !== base) out.push([key, v ? "1" : "0"]);
}

// ------------------------------------------------------------ view

/** Reads the table's part of a query string against the tab's base. */
export function parseView<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, search: string | URLSearchParams, base: TableBase<F>): TableView<F> {
  const params = toParams(search);
  const filters = spec.filterModel.parse(params, base.filters);
  const tri = params.get("tri");
  const key = isSortKey(spec, tri) ? tri : base.sort.key;
  const natural = key === base.sort.key ? base.sort.dir : sortDefaultDir(spec, key);
  const ordre = params.get("ordre");
  const dir = ordre === "asc" || ordre === "desc" ? ordre : natural;
  const colsRaw = params.get("cols");
  const wanted = colsRaw === null ? null : new Set(colsRaw.split(","));
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const par = Number.parseInt(params.get("par") ?? "", 10);
  return {
    filters,
    sort: { key, dir },
    cols: wanted ? spec.columns.map((c) => c.key).filter((k) => wanted.has(k)) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    perPage: spec.perPageOptions.includes(par) ? par : base.perPage,
  };
}

/** The view's differences from the base, in a fixed order. */
export function viewParams<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: TableView<F>, base: TableBase<F>): Array<[string, string]> {
  const out = spec.filterModel.serialize(view.filters, base.filters);
  if (view.sort.key !== base.sort.key) out.push(["tri", view.sort.key]);
  const natural = view.sort.key === base.sort.key ? base.sort.dir : sortDefaultDir(spec, view.sort.key);
  if (view.sort.dir !== natural) out.push(["ordre", view.sort.dir]);
  if (view.cols && !sameCols(view.cols, base.cols)) out.push(["cols", view.cols.join(",")]);
  if (view.page > 1) out.push(["page", String(view.page)]);
  if (view.perPage !== base.perPage) out.push(["par", String(view.perPage)]);
  return out;
}

/**
 * `search` with the table's keys replaced by `view` (other keys such as
 * `team` kept, in place): `?team=x&statut=dispo`, or "" at the base.
 */
export function viewSearch<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: TableView<F>, base: TableBase<F>, search: string): string {
  const params = new URLSearchParams(search);
  for (const k of ownedParams(spec)) params.delete(k);
  for (const [k, v] of viewParams(spec, view, base)) params.append(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

const serialized = <R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: TableView<F>, base: TableBase<F>) =>
  new URLSearchParams(viewParams(spec, view, base)).toString();

/** `search` already says `view` (same settings, whatever the key order; `vue` / `joueur` aside). */
export function sameViewSearch<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, view: TableView<F>, base: TableBase<F>, search: string): boolean {
  return serialized(spec, parseView(spec, search, base), base) === serialized(spec, view, base);
}

/** A `vue` or `joueur` param still waits in the address (resolved, it is dropped). */
export function hasPendingParams(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.has(PRESET_PARAM) || params.has(FOCUS_PARAM);
}

/** The address names a view (or a preset / player to open). */
export function hasViewParams<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, search: string): boolean {
  const params = new URLSearchParams(search);
  return ownedParams(spec).some((k) => params.has(k));
}

/** The preset a `?vue=` link names, or null. */
export function presetFromSearch<R, F, Caps, Ctx>(spec: TableSpec<R, F, Caps, Ctx>, search: string): string | null {
  const v = new URLSearchParams(search).get(PRESET_PARAM);
  return v && spec.presets.some((p) => p.id === v) ? v : null;
}

/** The player a `?joueur=` link opens (a row key), or null. */
export function focusFromSearch(search: string): string | null {
  const v = new URLSearchParams(search).get(FOCUS_PARAM)?.trim();
  return v && /^[\w:.-]{1,40}$/.test(v) ? v : null;
}
