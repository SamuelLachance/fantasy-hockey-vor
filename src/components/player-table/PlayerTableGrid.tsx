"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown } from "lucide-react";
import { Fragment, memo, useRef, type ComponentType } from "react";
import { useHorizontalScrollShadow } from "@/hooks/useHorizontalScrollShadow";
import { detailsToggleLabel, sortButtonLabel, TABLE_COPY } from "@/lib/player-table/copy";
import { columnDef, columnLabel, columnTitle } from "@/lib/player-table/model";
import { NAME_SORT, type ColumnDef, type SortDir, type SortState } from "@/lib/player-table/types";
import type { TableAdapter } from "./adapter";
import { PlayerTableDetail } from "./PlayerTableDetail";

const TD = {
  right: "whitespace-nowrap px-2 py-2 text-right tabular-nums",
  left: "px-2 py-2 text-left",
} as const;
/** Phones: the column's value sits under the player's name instead. */
const MOBILE_UNDER_NAME = "max-sm:hidden";
/** Sticky cells get a shadow once the table is scrolled sideways (set by useHorizontalScrollShadow). */
const STICKY_SHADOW = "group-data-[scrolled]/hscroll:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.8)]";

function SortGlyph({ active, dir }: { active: boolean; dir: SortDir }) {
  const cls = "h-3.5 w-3.5 shrink-0";
  if (!active) return <ArrowUpDown className={`${cls} opacity-40`} aria-hidden="true" />;
  return dir === "asc" ? <ArrowUp className={cls} aria-hidden="true" /> : <ArrowDown className={cls} aria-hidden="true" />;
}

const ariaSort = (active: boolean, dir: SortDir) => (active ? (dir === "asc" ? "ascending" : "descending") : "none");

// Any row type: the grid only hands rows back to the adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyAdapter = TableAdapter<any, any, any, any>;

interface RowProps {
  adapter: AnyAdapter;
  row: unknown;
  rowKey: string;
  name: string;
  columns: readonly string[];
  ctx: unknown;
  query: string;
  open: boolean;
  onToggle: (key: string) => void;
  idPrefix: string;
}

/** One player row (and its details when open); memoized: 250 rows re-render only when theirs change. */
const GridRow = memo(function GridRow({ adapter, row, rowKey, name, columns, ctx, query, open, onToggle, idPrefix }: RowProps) {
  const { NameCell, Detail, cells, spec } = adapter;
  const detailsId = `${idPrefix}-details-${rowKey}`;
  return (
    <Fragment>
      <tr id={`${idPrefix}-ligne-${rowKey}`} className={adapter.rowClass?.(row, ctx)}>
        {/* Its own cell, so the row header (read with every cell) is just the player. */}
        <td className="sticky left-0 z-10 w-11 min-w-11 bg-slate-950 py-1.5 pl-2 pr-0 align-top">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={open ? detailsId : undefined}
            onClick={() => onToggle(rowKey)}
            className="inline-flex h-11 w-9 items-center justify-center rounded-md text-slate-400 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
            <span className="sr-only">{detailsToggleLabel(name, open)}</span>
          </button>
        </td>
        <th scope="row" className={`sticky left-11 z-10 bg-slate-950 px-2 py-2.5 text-left align-top font-normal ${STICKY_SHADOW}`}>
          <NameCell row={row} ctx={ctx} query={query} visible={columns} />
        </th>
        {columns.map((c) => {
          const cell = cells[c]?.(row, ctx);
          const def = columnDef(spec, c) as ColumnDef<unknown, unknown, unknown> | undefined;
          const cls = `${TD[def?.align ?? "right"]} ${cell?.className ?? ""} ${def?.mobileUnderName ? MOBILE_UNDER_NAME : ""}`;
          return (
            <td key={c} className={cls.trim()}>
              {cell?.node ?? "—"}
            </td>
          );
        })}
      </tr>
      {open ? (
        <PlayerTableDetail id={detailsId} colSpan={columns.length + 2}>
          <Detail row={row} ctx={ctx} idPrefix={`${idPrefix}-${rowKey}`} />
        </PlayerTableDetail>
      ) : null}
    </Fragment>
  );
}) as ComponentType<RowProps>;

export interface PlayerTableGridProps<R, F, Caps, Ctx> {
  idPrefix: string;
  adapter: TableAdapter<R, F, Caps, Ctx>;
  rows: readonly R[];
  columns: readonly string[];
  sort: SortState;
  onSort: (key: string) => void;
  ctx: Ctx;
  query: string;
  expanded: string | null;
  onToggle: (key: string) => void;
  caption: string;
}

/**
 * The table itself: row headers are the players (the details button has
 * its own leading cell), every sortable column sorts from its header, and
 * a row expands for its details. It scrolls sideways inside its own box
 * (never the page) with the first two columns pinned.
 */
export function PlayerTableGrid<R, F, Caps, Ctx>({
  idPrefix,
  adapter,
  rows,
  columns,
  sort,
  onSort,
  ctx,
  query,
  expanded,
  onToggle,
  caption,
}: PlayerTableGridProps<R, F, Caps, Ctx>) {
  const { spec } = adapter;
  const scroller = useRef<HTMLDivElement | null>(null);
  useHorizontalScrollShadow(scroller);
  const nameActive = sort.key === NAME_SORT;
  return (
    // `relative` keeps the absolutely positioned sr-only text inside the
    // scroller: without it the page itself scrolls sideways on phones.
    <div
      ref={scroller}
      className="group/hscroll relative -mx-4 overflow-x-auto sm:mx-0 sm:rounded-xl sm:border sm:border-white/10"
    >
      <table className="min-w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-slate-900 text-left text-xs uppercase tracking-wider text-slate-400">
          <tr>
            <th scope="col" className="sticky left-0 z-10 w-11 min-w-11 bg-slate-900 p-0">
              <span className="sr-only">{TABLE_COPY.details}</span>
            </th>
            <th
              scope="col"
              aria-sort={ariaSort(nameActive, sort.dir)}
              className={`sticky left-11 z-10 bg-slate-900 px-2 py-1 font-medium ${STICKY_SHADOW}`}
            >
              <button
                type="button"
                onClick={() => onSort(NAME_SORT)}
                aria-label={sortButtonLabel(TABLE_COPY.player, nameActive, sort.dir)}
                className="inline-flex min-h-11 items-center gap-1 rounded-md uppercase tracking-wider hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                {TABLE_COPY.player}
                <SortGlyph active={nameActive} dir={sort.dir} />
              </button>
            </th>
            {columns.map((c) => {
              const def = columnDef(spec, c);
              if (!def) return null;
              const label = columnLabel(def, ctx);
              const title = columnTitle(def, ctx);
              const sortable = !!def.sort;
              const active = sortable && sort.key === c;
              const align = def.align === "left" ? "text-left" : "text-right";
              return (
                <th
                  key={c}
                  scope="col"
                  title={title}
                  aria-sort={sortable ? ariaSort(active, sort.dir) : undefined}
                  className={`whitespace-nowrap px-2 py-1 font-medium ${align} ${def.mobileUnderName ? MOBILE_UNDER_NAME : ""}`}
                >
                  {!sortable ? (
                    <span className="inline-flex min-h-11 items-center">{label}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSort(c)}
                      aria-label={sortButtonLabel(label, active, sort.dir)}
                      className={`inline-flex min-h-11 items-center gap-1 rounded-md uppercase tracking-wider hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                        active ? "text-cyan-200" : ""
                      } ${align === "text-right" ? "flex-row-reverse" : ""}`}
                    >
                      <span>{label}</span>
                      <SortGlyph active={active} dir={sort.dir} />
                    </button>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {rows.map((r) => {
            const key = spec.rowKey(r);
            return (
              <GridRow
                key={key}
                adapter={adapter as AnyAdapter}
                row={r}
                rowKey={key}
                name={spec.nameOf(r)}
                columns={columns}
                ctx={ctx}
                query={query}
                open={expanded === key}
                onToggle={onToggle}
                idPrefix={idPrefix}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
