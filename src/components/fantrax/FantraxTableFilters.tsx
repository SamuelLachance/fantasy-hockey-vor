"use client";

import { SlidersHorizontal } from "lucide-react";
import { useId, useState } from "react";
import type { FilterUiProps } from "@/components/player-table/adapter";
import { CHIP, RangeField, Select, Toggle } from "@/components/player-table/fields";
import { BUTTON_CLASS as BUTTON } from "@/components/player-table/PlayerTableToolbar";
import { SLOT_LABEL } from "@/lib/fantrax/league-copy";
import { POOL_GROUPS } from "@/lib/fantrax/pool";
import {
  FANTRAX_TYPES,
  NO_NHL_TEAM,
  VERDICT_POSITIVE,
  type FantraxCaps,
  type FantraxCtx,
  type FantraxFilters as Filters,
} from "@/lib/fantrax/table";
import { TYPE_LABEL } from "@/lib/fantrax/table-copy";

/**
 * Captains Dynasty's filters in the player table's form: status (a team
 * included), NHL club, type, positions, age, the NHL-active / minors /
 * healthy toggles, then « Plus de filtres » (projection ranges, and the
 * dynasty and Snake filters once their data is in). The table's own
 * buttons (`actions`) sit next to « Plus de filtres ».
 */
export function FantraxTableFilters({
  idPrefix,
  filters: f,
  caps,
  ctx,
  labels,
  onFilters,
  actions,
}: FilterUiProps<Filters, FantraxCaps, FantraxCtx>) {
  const moreId = useId();
  const advancedCount =
    [f.fp, f.fpg, f.ros, f.adp, f.pNhl, f.eta, f.dyn].filter((r) => r.min !== null || r.max !== null).length +
    [f.verdict, f.trend, f.phase].filter(Boolean).length;
  // Open by default when a bookmarked view carries advanced filters; the
  // user's own toggle wins from then on.
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const showMore = moreOpen ?? advancedCount > 0;
  const phases = labels.phases ?? [];
  const verdicts = labels.verdicts ?? [];
  const trends = labels.trends ?? [];
  const nhlTeams = labels.nhlTeams ?? [];

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select label="Statut" value={f.status} onChange={(v) => onFilters({ status: v })}>
          <option value="tous">Tous les joueurs</option>
          <option value="dispo">{ctx.draftOpen ? "Disponibles au repêchage" : "Disponibles (autonomes et ballottage)"}</option>
          <option value="fa">Joueurs autonomes (FA)</option>
          <option value="ww">Au ballottage (WW)</option>
          <option value="pris">Pris par une équipe</option>
          <option value="moi">Mon équipe</option>
          <optgroup label="Une équipe précise">
            {ctx.teamIds.map((t) => (
              <option key={t} value={t}>
                {ctx.teamName(t)}
                {t === ctx.teamId ? " (mon équipe)" : ""}
              </option>
            ))}
          </optgroup>
        </Select>
        <Select label="Équipe LNH" value={f.nhlTeam} onChange={(v) => onFilters({ nhlTeam: v })}>
          <option value="">Toutes</option>
          {nhlTeams.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
          <option value={NO_NHL_TEAM}>Sans équipe LNH</option>
        </Select>
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Type</legend>
          <div className="flex min-h-11 rounded-xl border border-white/15 bg-slate-900 p-1">
            {FANTRAX_TYPES.map((t) => (
              <label
                key={t}
                className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg px-2 text-sm transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400 ${
                  f.type === t ? "bg-cyan-500/20 font-semibold text-cyan-100" : "text-slate-300 hover:text-white"
                }`}
              >
                <input
                  type="radio"
                  name={`${idPrefix}-type`}
                  value={t}
                  checked={f.type === t}
                  onChange={() => onFilters({ type: t })}
                  className="sr-only"
                />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_minmax(0,14rem)_1fr]">
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Positions</legend>
          <div className="flex flex-wrap gap-2">
            {POOL_GROUPS.map((g) => {
              const on = f.pos.includes(g);
              return (
                <label
                  key={g}
                  title={SLOT_LABEL[g]}
                  className={`${CHIP} min-w-11 ${
                    on ? "border-cyan-400/50 bg-cyan-500/15 font-semibold text-cyan-100" : "border-white/15 bg-white/5 text-slate-300"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={(e) =>
                      onFilters({
                        pos: POOL_GROUPS.filter((x) => (x === g ? e.target.checked : f.pos.includes(x))),
                      })
                    }
                    className="sr-only"
                  />
                  {/* The visible letter stays in the name (voice control: « C »). */}
                  {g}
                  <span className="sr-only"> ({SLOT_LABEL[g]})</span>
                </label>
              );
            })}
          </div>
        </fieldset>
        <RangeField label="Âge" value={f.age} onChange={(age) => onFilters({ age })} />
        <fieldset className="min-w-0">
          <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">Options</legend>
          <div className="flex flex-wrap gap-2">
            <Toggle
              label="Admissibles aux mineures"
              title="Admissibles aux postes des mineures de la ligue"
              checked={f.minors}
              onChange={(minors) => onFilters({ minors })}
            />
            <Toggle
              label="Actifs dans la LNH"
              title="Sans les joueurs sans club LNH, assignés aux mineures, sans contrat, suspendus, inactifs, blessés ou absents des listes de Fantrax (comme les onglets Repêchage et Ballottage)"
              checked={f.active}
              onChange={(active) => onFilters({ active })}
            />
            <Toggle
              label="Exclure les blessés"
              title="Sans les joueurs sur la liste des blessés de la LNH ou absents; ceux au jour le jour restent"
              checked={f.healthy}
              onChange={(healthy) => onFilters({ healthy })}
            />
          </div>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={showMore}
          aria-controls={moreId}
          onClick={() => setMoreOpen(!showMore)}
          className={BUTTON}
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          {showMore ? "Moins de filtres" : "Plus de filtres"}
          {advancedCount > 0 ? (
            <span className="rounded-full bg-cyan-500/20 px-1.5 text-xs tabular-nums text-cyan-100">
              {advancedCount}
              <span className="sr-only"> {advancedCount > 1 ? "actifs" : "actif"}</span>
            </span>
          ) : null}
        </button>
        {actions}
      </div>

      <div
        id={moreId}
        hidden={!showMore}
        className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <RangeField label="FP saison" value={f.fp} onChange={(fp) => onFilters({ fp })} />
        <RangeField label="FP/match" value={f.fpg} onChange={(fpg) => onFilters({ fpg })} />
        <RangeField label="% Fantrax" unit="%" value={f.ros} onChange={(ros) => onFilters({ ros })} />
        <RangeField label="ADP" value={f.adp} onChange={(adp) => onFilters({ adp })} />
        {caps.dynasty.has("value") ? (
          <RangeField label="Valeur dynastie" value={f.dyn} onChange={(dyn) => onFilters({ dyn })} />
        ) : null}
        {caps.dynasty.has("pNhl") ? (
          <RangeField label="P(LNH)" unit="%" value={f.pNhl} onChange={(pNhl) => onFilters({ pNhl })} />
        ) : null}
        {caps.dynasty.has("eta") ? (
          <RangeField label="ETA (saison)" value={f.eta} onChange={(eta) => onFilters({ eta })} />
        ) : null}
        {caps.dynasty.has("phase") && phases.length ? (
          <Select label="Phase de carrière" value={f.phase} onChange={(phase) => onFilters({ phase })}>
            <option value="">Toutes</option>
            {phases.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        ) : null}
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
        {!caps.snake ? (
          <p className="text-xs text-slate-400 sm:col-span-2 lg:col-span-4">
            {"Les filtres Snake (verdict, tendance) apparaissent dès que ses avis sont chargés."}
          </p>
        ) : null}
      </div>
    </>
  );
}
