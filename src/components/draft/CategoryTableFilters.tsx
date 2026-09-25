"use client";

import type { FilterUiProps } from "@/components/player-table/adapter";
import { CHIP, RangeField, Select, useMoreFilters } from "@/components/player-table/fields";
import { DRAFT_FILTERS, draftFilterLabel } from "@/lib/draft/board-filter";
import {
  VERDICT_POSITIVE,
  type CategoryCaps,
  type CategoryCtx,
  type CategoryFilters as Filters,
  type CategoryStatus,
} from "@/lib/draft/table";

const POSITION_NAME: Record<string, string> = {
  ALL: "toutes les positions",
  C: "centres",
  LW: "ailiers gauches",
  RW: "ailiers droits",
  F: "attaquants (C, LW ou RW)",
  D: "défenseurs",
  G: "gardiens",
};

/**
 * A categories league's filters in the player table's form: status (from
 * the draft marked on this device), one position (the draft board's: F =
 * any forward), then « Plus de filtres » (VOR, ADP, age and Snake's
 * verdict and trend). The table's own buttons (`actions`) sit next to
 * « Plus de filtres ».
 */
export function CategoryTableFilters({
  idPrefix,
  filters: f,
  caps,
  labels,
  onFilters,
  actions,
}: FilterUiProps<Filters, CategoryCaps, CategoryCtx>) {
  const set = (r: { min: number | null; max: number | null }) => r.min !== null || r.max !== null;
  const advancedCount = [f.vor, f.adp, f.age].filter(set).length + [f.verdict, f.trend].filter(Boolean).length;
  const more = useMoreFilters(advancedCount);
  const verdicts = labels.verdicts ?? [];
  const trends = labels.trends ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_1fr]">
        <Select label="Statut" value={f.status} onChange={(v) => onFilters({ status: v as CategoryStatus })}>
          <option value="tous">Tous les joueurs</option>
          <option value="dispo">{caps.done ? "Non repêchés" : "Disponibles"}</option>
          <option value="pris">Repêchés</option>
          <option value="moi">Mon équipe</option>
        </Select>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Position</legend>
          <div className="flex flex-wrap gap-2">
            {DRAFT_FILTERS.map((p) => {
              const on = f.pos === p;
              return (
                <label
                  key={p}
                  title={POSITION_NAME[p]}
                  className={`${CHIP} min-w-11 ${
                    on ? "border-cyan-400/50 bg-cyan-500/15 font-semibold text-cyan-100" : "border-white/15 bg-white/5 text-slate-300"
                  }`}
                >
                  <input
                    type="radio"
                    name={`${idPrefix}-position`}
                    value={p}
                    checked={on}
                    onChange={() => onFilters({ pos: p })}
                    className="sr-only"
                  />
                  {/* The visible letters stay in the name (voice control: « C »). */}
                  {draftFilterLabel(p)}
                  {p !== "ALL" ? <span className="sr-only"> ({POSITION_NAME[p]})</span> : null}
                </label>
              );
            })}
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {more.button}
        {actions}
      </div>

      <div
        id={more.id}
        hidden={!more.open}
        className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <RangeField label="VOR" value={f.vor} onChange={(vor) => onFilters({ vor })} />
        <RangeField label="ADP" value={f.adp} onChange={(adp) => onFilters({ adp })} />
        <RangeField label="Âge" value={f.age} onChange={(age) => onFilters({ age })} />
        {caps.snake && verdicts.length ? (
          <Select label="Verdict de Snake" value={f.verdict} onChange={(verdict) => onFilters({ verdict })}>
            <option value="">Tous</option>
            <option value={VERDICT_POSITIVE}>Positif ou mieux</option>
            {verdicts.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </Select>
        ) : null}
        {caps.snake && trends.length ? (
          <Select label="Tendance (Snake)" value={f.trend} onChange={(trend) => onFilters({ trend })}>
            <option value="">Toutes</option>
            {trends.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
    </>
  );
}
