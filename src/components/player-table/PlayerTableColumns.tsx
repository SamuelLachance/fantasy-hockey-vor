"use client";

import { TABLE_COPY } from "@/lib/player-table/copy";
import { columnLabel, columnTitle } from "@/lib/player-table/model";
import type { TableSpec } from "@/lib/player-table/types";

const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border px-3 text-sm transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400";

/**
 * « Colonnes affichées »: one checkbox per column the data can fill,
 * grouped (Projection, Repêchage, Snake…). Columns fetched on demand say so.
 */
export function PlayerTableColumns<R, F, Caps, Ctx>({
  id,
  spec,
  caps,
  ctx,
  visible,
  hidden,
  onColumns,
}: {
  id: string;
  spec: TableSpec<R, F, Caps, Ctx>;
  caps: Caps;
  ctx: Ctx;
  visible: readonly string[];
  hidden: boolean;
  onColumns: (cols: string[]) => void;
}) {
  const available = spec.columns.filter((c) => c.needs?.(caps) ?? true);
  const groups = [...new Set(available.map((c) => c.group))];
  const toggle = (key: string, on: boolean) => {
    const set = new Set(visible);
    if (on) set.add(key);
    else set.delete(key);
    onColumns(spec.columns.map((c) => c.key).filter((k) => set.has(k)));
  };
  return (
    <fieldset id={id} hidden={hidden} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wider text-slate-400">{TABLE_COPY.columnsLegend}</legend>
      <div className="space-y-3">
        {groups.map((g) => (
          <fieldset key={g} className="min-w-0">
            <legend className="mb-1 text-xs text-slate-400">{g}</legend>
            <div className="flex flex-wrap gap-2">
              {available
                .filter((c) => c.group === g)
                .map((c) => {
                  const on = visible.includes(c.key);
                  return (
                    <label
                      key={c.key}
                      title={columnTitle(c, ctx)}
                      className={`${CHIP} ${on ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : "border-white/15 bg-white/5 text-slate-400"}`}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={(e) => toggle(c.key, e.target.checked)}
                        className="h-4 w-4 accent-cyan-400"
                      />
                      {columnLabel(c, ctx)}
                      {c.lazy ? <span className="text-xs text-slate-400">{` ${TABLE_COPY.lazyColumn}`}</span> : null}
                    </label>
                  );
                })}
            </div>
          </fieldset>
        ))}
      </div>
    </fieldset>
  );
}
