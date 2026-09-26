"use client";

import { RangeField, Select } from "@/components/player-table/fields";
import type { KeeperStatus, Phase } from "@/lib/dynasty/types";
import { FIRST_CUTDOWN, isPhase, KEEPER_FILTER_LABEL, KEEPER_ORDER, PHASE_FILTER_LABEL } from "@/lib/fantrax/dynasty-hints";
import { DYNASTY_MODE_LABEL, type DynastyMode } from "@/lib/fantrax/dynasty-mode";
import { FREE_AT_YEARS, type FantraxFilters as Filters } from "@/lib/fantrax/table";

/** « 2027 », « 2027 et 2028 », « 2027 à 2029 »: free at every cutdown up to the one chosen, that one included. */
const freeAtLabel = (y: number) => (y === FIRST_CUTDOWN ? `${y}` : y === FIRST_CUTDOWN + 1 ? `${FIRST_CUTDOWN} et ${y}` : `${FIRST_CUTDOWN} à ${y}`);

/**
 * The dynasty row of the Captains filters, once dynasty.json is in: phase,
 * value in the page's mode, 2027 cutdown (the cells' words: Protéger, À
 * décider, Location, Gratuit), free at the cutdowns, NHL odds. Its own
 * chunk (the filters' dynasty part never ships before the file).
 */
export function FantraxDynastyFilters({
  filters: f,
  mode,
  phases,
  onFilters,
}: {
  filters: Filters;
  mode: DynastyMode;
  phases: readonly string[];
  onFilters: (patch: Partial<Filters>) => void;
}) {
  return (
    <fieldset className="min-w-0 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.03] p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wider text-cyan-200">
        Dynastie · mode {DYNASTY_MODE_LABEL[mode]}
      </legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Select label="Phase de carrière" value={f.phase} onChange={(phase) => onFilters({ phase: isPhase(phase) ? (phase as Phase) : "" })}>
          <option value="">Toutes</option>
          {phases.filter(isPhase).map((p) => (
            <option key={p} value={p}>
              {PHASE_FILTER_LABEL[p]}
            </option>
          ))}
        </Select>
        <RangeField label="Valeur dynastie" value={f.dyn} onChange={(dyn) => onFilters({ dyn })} />
        <Select
          label={`Écrémage ${FIRST_CUTDOWN}`}
          value={f.keeper}
          onChange={(v) => onFilters({ keeper: (KEEPER_ORDER as readonly string[]).includes(v) ? (v as KeeperStatus) : "" })}
        >
          <option value="">Tous</option>
          {KEEPER_ORDER.map((k) => (
            <option key={k} value={k}>
              {KEEPER_FILTER_LABEL[k]}
            </option>
          ))}
        </Select>
        <Select
          label="Gratuit aux écrémages"
          value={f.freeAt === null ? "" : String(f.freeAt)}
          onChange={(v) => onFilters({ freeAt: v ? Number(v) : null })}
        >
          <option value="">Peu importe</option>
          {FREE_AT_YEARS.map((y) => (
            <option key={y} value={y}>
              {freeAtLabel(y)}
            </option>
          ))}
        </Select>
        <RangeField label="Chances LNH" unit="%" value={f.pNhl} onChange={(pNhl) => onFilters({ pNhl })} />
      </div>
    </fieldset>
  );
}
