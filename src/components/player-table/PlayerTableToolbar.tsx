"use client";

import { Columns3, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { TABLE_COPY } from "@/lib/player-table/copy";
import { matchesPreset } from "@/lib/player-table/model";
import type { ResolvedPreset, SortState } from "@/lib/player-table/types";
import type { TableAdapter } from "./adapter";
import { PlayerTableColumns } from "./PlayerTableColumns";

export const FIELD_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 sm:text-sm";
export const LABEL_CLASS = "flex min-w-0 flex-col gap-1 text-xs font-medium uppercase tracking-wider text-slate-400";
export const BUTTON_CLASS =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";

function CountBadge({ n, one, many }: { n: number; one: string; many: string }) {
  if (n <= 0) return null;
  return (
    <span className="rounded-full bg-cyan-500/20 px-1.5 text-xs tabular-nums text-cyan-100">
      {n}
      <span className="sr-only"> {n > 1 ? many : one}</span>
    </span>
  );
}

export interface PlayerTableToolbarProps<R, F, Caps, Ctx> {
  idPrefix: string;
  adapter: TableAdapter<R, F, Caps, Ctx>;
  /** The view as applied (filters normalized for this data, the sort on screen). */
  shown: { filters: F; sort: SortState };
  caps: Caps;
  ctx: Ctx;
  labels: Readonly<Record<string, readonly string[]>>;
  chips: readonly ResolvedPreset<F>[];
  visible: readonly string[];
  activeCount: number;
  atBase: boolean;
  onQuery: (q: string) => void;
  onFilters: (patch: Partial<F>) => void;
  onPreset: (p: ResolvedPreset<F>) => void;
  onReset: () => void;
  onColumns: (cols: string[]) => void;
  extra?: ReactNode;
  /** Filters folded behind « Filtres » at every width, not only on phones. */
  compact?: boolean;
}

/**
 * Preset chips, the search box, the league's own filters, the column
 * chooser and « Réinitialiser ». On phones (and at every width when
 * `compact`) the filters fold away behind « Filtres » so the table stays close.
 */
export function PlayerTableToolbar<R, F, Caps, Ctx>({
  idPrefix,
  adapter,
  shown,
  caps,
  ctx,
  labels,
  chips,
  visible,
  activeCount,
  atBase,
  onQuery,
  onFilters,
  onPreset,
  onReset,
  onColumns,
  extra,
  compact = false,
}: PlayerTableToolbarProps<R, F, Caps, Ctx>) {
  const { spec, Filters } = adapter;
  const [panelOpen, setPanelOpen] = useState(false);
  const [colsOpen, setColsOpen] = useState(false);
  const panelId = useId();
  const colsId = useId();
  const searchId = `${idPrefix}-recherche`;
  const chipsId = `${idPrefix}-vues`;

  const actions = (
    <>
      <button
        type="button"
        aria-expanded={colsOpen}
        aria-controls={colsId}
        onClick={() => setColsOpen((o) => !o)}
        className={BUTTON_CLASS}
      >
        <Columns3 className="h-4 w-4" aria-hidden="true" />
        {TABLE_COPY.columns}
      </button>
      {/* aria-disabled, not disabled: the button keeps the focus once the view is back to the tab's. */}
      <button
        type="button"
        onClick={() => {
          if (!atBase) onReset();
        }}
        aria-disabled={atBase || undefined}
        className={`${BUTTON_CLASS} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-white/15`}
      >
        <RotateCcw className="h-4 w-4" aria-hidden="true" />
        {TABLE_COPY.reset}
        <CountBadge n={activeCount} one="filtre actif" many="filtres actifs" />
      </button>
    </>
  );

  return (
    <div className="space-y-4">
      {chips.length > 1 ? (
        <div>
          <h3 id={chipsId} className="text-xs font-medium uppercase tracking-wider text-slate-400">
            {TABLE_COPY.presets}
          </h3>
          <ul aria-labelledby={chipsId} className="mt-2 flex flex-wrap gap-2">
            {chips.map((p) => {
              const on = matchesPreset(spec, shown, p);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    title={p.description}
                    onClick={() => onPreset(p)}
                    className={`inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                      on
                        ? "border-violet-400/60 bg-violet-500/20 text-violet-50"
                        : "border-white/15 bg-white/5 text-slate-200 hover:border-violet-400/40 hover:text-white"
                    }`}
                  >
                    {p.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <form role="search" aria-label={TABLE_COPY.form} onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div className="flex items-end gap-2">
          <label className={`${LABEL_CLASS} flex-1`}>
            {TABLE_COPY.search}
            <input
              id={searchId}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              name={searchId}
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              placeholder={TABLE_COPY.searchPlaceholder}
              value={spec.filterModel.query(shown.filters)}
              onChange={(e) => onQuery(e.target.value)}
              className={`${FIELD_CLASS} normal-case tracking-normal`}
            />
          </label>
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((o) => !o)}
            className={`${BUTTON_CLASS} shrink-0 ${compact ? "" : "sm:hidden"}`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            {TABLE_COPY.filters}
            <CountBadge n={activeCount} one="actif" many="actifs" />
          </button>
        </div>

        <div id={panelId} className={`space-y-4 ${panelOpen ? "" : compact ? "hidden" : "max-sm:hidden"}`}>
          <Filters
            idPrefix={idPrefix}
            filters={shown.filters}
            caps={caps}
            ctx={ctx}
            labels={labels}
            onFilters={onFilters}
            actions={actions}
          />
          <PlayerTableColumns
            id={colsId}
            spec={spec}
            caps={caps}
            ctx={ctx}
            visible={visible}
            hidden={!colsOpen}
            onColumns={onColumns}
          />
          {extra}
        </div>
      </form>
    </div>
  );
}
