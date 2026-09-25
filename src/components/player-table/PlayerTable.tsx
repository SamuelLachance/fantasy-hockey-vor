"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { counterText, fmtInt, TABLE_COPY, tableCaption } from "@/lib/player-table/copy";
import {
  applyPreset,
  atBase,
  baseView,
  clampPage,
  columnDef,
  effectiveView,
  filterRows,
  findPreset,
  matchesPreset,
  nextSort,
  pageCount,
  resetView,
  resolvePreset,
  sortLabel,
  sortRows,
  tableBase,
  viewContext,
  viewReadsExtras,
} from "@/lib/player-table/model";
import type { ResolvedPreset } from "@/lib/player-table/types";
import type { TableAdapter, TableData } from "./adapter";
import { PlayerTableGrid } from "./PlayerTableGrid";
import { PlayerTablePager } from "./PlayerTablePager";
import { PlayerTableToolbar } from "./PlayerTableToolbar";
import { useCountAnnouncer } from "./useCountAnnouncer";
import { usePlayerTableView } from "./usePlayerTableView";

export interface PlayerTableProps<R, F, Caps, Ctx> {
  /** DOM prefix: section `id`, heading `${id}-titre`, search `${id}-recherche`. */
  id: string;
  /** Visible h2. */
  title: string;
  description?: ReactNode;
  adapter: TableAdapter<R, F, Caps, Ctx>;
  data: TableData<R, Caps, Ctx>;
  /** Preset the tab starts from (and « Réinitialiser » returns to); null = the spec's defaults. */
  base: string | null;
  /** Preset chips shown on this tab. */
  presets: readonly string[];
  /** Page size the tab starts with. */
  perPage: number;
  /** « eager »: the data hook loads at once; « viewport »: when the table nears the screen. */
  load?: "eager" | "viewport";
  toolbarExtra?: ReactNode;
  /** Extra note under the table (the tab's own). */
  footer?: ReactNode;
  /** Filters folded behind « Filtres » at every width (search and chips stay): rows come first. */
  compactFilters?: boolean;
  /** Show the pool size next to the title (only where the title names the whole pool). */
  showTotal?: boolean;
}

/**
 * The one player table of the site: presets, search, the league's own
 * filters, columns to choose, sorts, pages and a details row, with the
 * view kept in the address (its difference from the tab's base view).
 * Each kind of league brings its adapter (rows, columns, filters, cells)
 * and its data hook; this component only arranges them.
 */
export function PlayerTable<R, F, Caps, Ctx>({
  id,
  title,
  description,
  adapter,
  data,
  base: baseId,
  presets: chipIds,
  perPage,
  load = "eager",
  toolbarExtra,
  footer,
  compactFilters = false,
  showTotal = false,
}: PlayerTableProps<R, F, Caps, Ctx>) {
  const { spec } = adapter;
  const { caps, ctx, labels, want } = data;
  const base = useMemo(() => tableBase(spec, baseId, caps, perPage), [spec, baseId, caps, perPage]);
  const { view, setView, explicit, pendingPreset, clearPendingPreset, focus, clearFocus, reader } = usePlayerTableView(spec, base);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const resultsRef = useRef<HTMLParagraphElement | null>(null);
  /** The last preset applied, so a later version of it (dynasty data in) can replace it. */
  const applied = useRef<ResolvedPreset<F> | null>(null);
  /** A `?joueur=` row to bring into view once it renders. */
  const scrollTarget = useRef<string | null>(null);

  // ---- load: an address naming a view loads at once; « viewport » near the screen
  useEffect(() => {
    if (explicit) want();
  }, [explicit, want]);
  useEffect(() => {
    const el = sectionRef.current;
    if (load !== "viewport" || data.status !== "idle" || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = window.setTimeout(want, 0);
      return () => window.clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) want();
      },
      { rootMargin: "600px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [load, data.status, want]);

  // ---- what the view does with this data
  const env = useMemo(() => ({ caps, labels, ctx }), [caps, labels, ctx]);
  const effective = useMemo(() => effectiveView(spec, view, base, env), [spec, view, base, env]);
  const allPresets = useMemo(() => spec.presets.map((p) => resolvePreset(spec, p, caps)), [spec, caps]);
  const chips = useMemo(
    () => chipIds.map((pid) => allPresets.find((p) => p.id === pid)).filter((p): p is ResolvedPreset<F> => !!p),
    [chipIds, allPresets],
  );

  const ready = data.status === "ready";
  const waitingExtras =
    ready &&
    (viewReadsExtras(spec, view).some((k) => !data.extras[k]) ||
      (columnDef(spec, effective.sort.key)?.lazy === "snakeFull" && !data.extras.snakeFull));
  const fallback = !ready && data.fallbackRows && data.fallbackRows.length > 0 ? data.fallbackRows : null;
  const source = ready ? data.rows : fallback;
  const showRows = !!source && !waitingExtras;

  // A lazy column shown or sorted: fetch its data.
  const { wantFullSnake } = data;
  const needFull =
    effective.columns.some((c) => columnDef(spec, c)?.lazy === "snakeFull") ||
    columnDef(spec, effective.sort.key)?.lazy === "snakeFull";
  useEffect(() => {
    if (needFull) wantFullSnake();
  }, [needFull, wantFullSnake]);

  // Typing stays responsive: the rows follow the filters a beat later.
  const filters = useDeferredValue(effective.filters);
  // What cells, headers and sorts see for this view (ranks by the filtered position…).
  const vctx = useMemo(() => viewContext(spec, ctx, filters), [spec, ctx, filters]);
  const sorted = useMemo(
    () => (source ? sortRows(spec, filterRows(spec, source, filters, vctx), effective.sort, vctx) : []),
    [spec, source, filters, vctx, effective.sort],
  );
  const pages = pageCount(sorted.length, view.perPage);
  const page = clampPage(view.page, sorted.length, view.perPage);
  const pageRows = useMemo(() => sorted.slice((page - 1) * view.perPage, page * view.perPage), [sorted, page, view.perPage]);

  const counter = waitingExtras
    ? TABLE_COPY.loadingExtras
    : showRows
      ? counterText(sorted.length, page, pages, { label: sortLabel(spec, effective.sort.key, vctx), dir: effective.sort.dir })
      : data.status === "error"
        ? TABLE_COPY.error
        : data.status === "loading"
          ? TABLE_COPY.loading
          : "";
  const announcer = useCountAnnouncer(counter, showRows && pendingPreset === null);
  const { bump } = announcer;

  // ---- actions (each announces the new count)
  const onFilters = useCallback(
    (patch: Partial<F>) => {
      setView((v) => ({ ...v, filters: { ...v.filters, ...patch }, page: 1 }));
      setNotice(null);
      bump();
    },
    [setView, bump],
  );
  const onQuery = useCallback(
    (q: string) => {
      setView((v) => ({ ...v, filters: spec.filterModel.withQuery(v.filters, q), page: 1 }));
      setNotice(null);
      bump();
    },
    [setView, spec, bump],
  );
  const effectiveSort = effective.sort;
  const onSort = useCallback(
    (key: string) => {
      // From the sort on screen, which may be a fallback of the URL's.
      setView((v) => ({ ...v, sort: nextSort(spec, effectiveSort, key), page: 1 }));
      bump();
    },
    [setView, spec, effectiveSort, bump],
  );
  const onPreset = useCallback(
    (p: ResolvedPreset<F>) => {
      applied.current = p;
      setView((v) => applyPreset(v, p, base));
      setExpanded(null);
      want();
      bump();
    },
    [setView, base, want, bump],
  );
  const onReset = useCallback(() => {
    applied.current = null;
    setView((v) => resetView(v, base));
    bump();
  }, [setView, base, bump]);
  const onColumns = useCallback((cols: string[]) => setView((v) => ({ ...v, cols })), [setView]);
  const onToggle = useCallback((key: string) => setExpanded((e) => (e === key ? null : key)), []);
  const goTo = (n: number) => {
    setView((v) => ({ ...v, page: n }));
    setExpanded(null);
    bump();
    resultsRef.current?.scrollIntoView({ block: "nearest" });
  };
  const retry = () => {
    data.retry();
    bump();
    // The button goes away while loading: keep focus in the section.
    document.getElementById(`${id}-titre`)?.focus({ preventScroll: true });
  };

  // ---- `?vue=`: presets are resolved with the data on hand (their sort can depend on it)
  useEffect(() => {
    if (!pendingPreset || (data.status !== "ready" && data.status !== "error")) return;
    const p = findPreset(spec, pendingPreset, caps);
    const t = window.setTimeout(() => {
      clearPendingPreset();
      if (!p) return;
      applied.current = p;
      setView((v) => applyPreset(v, p, base));
      setExpanded(null);
    }, 0);
    return () => window.clearTimeout(t);
  }, [pendingPreset, data.status, spec, caps, base, setView, clearPendingPreset]);

  // Data arriving after a preset was applied can change that preset
  // (prospects by dynasty value): follow it while the view is untouched.
  useEffect(() => {
    const old = applied.current;
    if (!old) return;
    const next = allPresets.find((x) => x.id === old.id);
    if (!next || matchesPreset(spec, next, old)) return;
    const t = window.setTimeout(() => {
      applied.current = next;
      setView((v) => (matchesPreset(spec, v, old) ? { ...v, filters: { ...next.filters }, sort: { ...next.sort } } : v));
    }, 0);
    return () => window.clearTimeout(t);
  }, [allPresets, spec, setView]);

  // ---- `?joueur=`: search him from the tab's view, open his details, bring him into view
  useEffect(() => {
    if (!focus || (data.status !== "ready" && data.status !== "error")) return;
    const row = data.rows.find((r) => spec.rowKey(r) === focus);
    const t = window.setTimeout(() => {
      clearFocus();
      if (!row) {
        setNotice(TABLE_COPY.notInPool);
        return;
      }
      setNotice(null);
      scrollTarget.current = focus;
      setView((v) => ({
        ...baseView(base),
        cols: v.cols,
        perPage: v.perPage,
        filters: spec.filterModel.withQuery(base.filters, spec.nameOf(row)),
      }));
      setExpanded(focus);
    }, 0);
    return () => window.clearTimeout(t);
  }, [focus, data.status, data.rows, spec, base, setView, clearFocus]);
  useEffect(() => {
    const key = scrollTarget.current;
    if (!key || expanded !== key) return;
    const el = document.getElementById(`${id}-ligne-${key}`);
    if (!el) return;
    scrollTarget.current = null;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  }, [id, expanded, pageRows]);

  const shown = useMemo(() => ({ filters: effective.filters, sort: effective.sort }), [effective]);
  const activeCount = spec.filterModel.activeCount(effective.filters, base.filters);
  const isAtBase = atBase(spec, { ...view, filters: effective.filters, sort: effective.sort }, base);
  const query = spec.filterModel.query(filters);

  return (
    <section
      id={id}
      ref={sectionRef}
      aria-labelledby={`${id}-titre`}
      className="min-w-0 scroll-mt-4 rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 to-slate-950/80 p-4 sm:p-6"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2
          id={`${id}-titre`}
          tabIndex={-1}
          className="rounded-md text-lg font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          {title}
        </h2>
        {showTotal && data.total !== null ? (
          <span className="text-xs tabular-nums text-slate-400">{TABLE_COPY.poolTotal(fmtInt(data.total))}</span>
        ) : null}
      </div>
      {description ? <p className="mb-4 text-sm text-slate-400">{description}</p> : null}
      {reader}

      <PlayerTableToolbar
        idPrefix={id}
        adapter={adapter}
        shown={shown}
        caps={caps}
        ctx={vctx}
        labels={labels}
        chips={chips}
        visible={effective.columns}
        activeCount={activeCount}
        atBase={isAtBase}
        onQuery={onQuery}
        onFilters={onFilters}
        onPreset={onPreset}
        onReset={onReset}
        onColumns={onColumns}
        extra={toolbarExtra}
        compact={compactFilters}
      />

      <div className="mt-4">
        {/* The visible counter follows the data (live picks included); the
            polite status below only speaks after the user's own changes. */}
        <p ref={resultsRef} className="mb-2 scroll-mt-4 text-sm font-medium text-slate-300">
          {counter}
        </p>
        {announcer.region}
        {notice ? <p className="mb-2 text-sm text-amber-200">{notice}</p> : null}
        {fallback && data.status !== "error" ? (
          <p className="mb-2 text-xs text-slate-400">{data.fallbackNote?.loading ?? TABLE_COPY.loadingFull}</p>
        ) : null}
        {fallback && data.status === "error" && data.fallbackNote ? (
          <p className="mb-2 text-xs text-amber-200">{data.fallbackNote.error}</p>
        ) : null}
        {data.status === "error" ? (
          <p className="mb-2 flex flex-wrap items-center gap-x-3 text-sm text-rose-200">
            {fallback ? TABLE_COPY.error : null}
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-11 items-center rounded-xl border border-rose-300/40 px-4 text-sm font-semibold text-rose-50 hover:bg-rose-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
            >
              {TABLE_COPY.retry}
            </button>
          </p>
        ) : null}

        {showRows && sorted.length > 0 ? (
          <PlayerTableGrid
            idPrefix={id}
            adapter={adapter}
            rows={pageRows}
            columns={effective.columns}
            sort={effective.sort}
            onSort={onSort}
            ctx={vctx}
            query={query}
            expanded={expanded}
            onToggle={onToggle}
            caption={tableCaption(title, counter)}
          />
        ) : null}

        {showRows && sorted.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-300">
            <p>{TABLE_COPY.empty}</p>
            <button
              type="button"
              onClick={() => {
                onReset();
                // This button goes away with the empty state: keep focus in the form.
                window.setTimeout(() => document.getElementById(`${id}-recherche`)?.focus(), 0);
              }}
              className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 font-semibold text-cyan-100 hover:bg-cyan-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            >
              {TABLE_COPY.resetFilters}
            </button>
          </div>
        ) : null}

        {showRows && sorted.length > 0 ? (
          <PlayerTablePager
            page={page}
            pages={pages}
            perPage={view.perPage}
            perPageOptions={spec.perPageOptions}
            onPage={goTo}
            onPerPage={(n) => {
              setView((v) => ({ ...v, perPage: n, page: 1 }));
              bump();
            }}
          />
        ) : null}

        {footer ? <div className="mt-3 text-xs text-slate-400">{footer}</div> : null}
      </div>
    </section>
  );
}
