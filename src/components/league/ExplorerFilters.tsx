"use client";

import { Columns3, RotateCcw, SlidersHorizontal } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { columnCopy, TYPE_LABEL } from "@/lib/fantrax/explorer-copy";
import {
  activeFilterCount,
  columnAvailable,
  COLUMN_KEYS,
  DEFAULT_VIEW,
  EXPLORER_TYPES,
  matchesPreset,
  NO_NHL_TEAM,
  VERDICT_POSITIVE,
  type ColumnKey,
  type ExplorerCapabilities,
  type ExplorerFilters as Filters,
  type ExplorerPreset,
  type ExplorerView,
  type Range,
} from "@/lib/fantrax/explorer";
import { SLOT_LABEL } from "@/lib/fantrax/league-copy";
import { POOL_GROUPS } from "@/lib/fantrax/pool";

const FIELD =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-base text-white placeholder:text-slate-500 focus:border-cyan-400/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 sm:text-sm";
const LABEL = "flex min-w-0 flex-col gap-1 text-xs font-medium uppercase tracking-wider text-slate-400";
const CHIP =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400";
const BUTTON =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50";

/** `2,5` or `2.5` → 2.5; blank or junk → null. */
export function parseBound(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

const showBound = (x: number | null) => (x === null ? "" : String(x).replace(".", ","));

/** The name search (focus lands here after « Réinitialiser les filtres » in the empty state). */
export const SEARCH_INPUT_ID = "explorateur-recherche";

/**
 * Min / max pair. The text is local (so "2," can be typed on the way to
 * "2,5"); a change from outside (reset, preset, Back) replaces it.
 */
function RangeField({
  label,
  value,
  onChange,
  unit,
}: {
  label: string;
  value: Range;
  onChange: (r: Range) => void;
  unit?: string;
}) {
  const id = useId();
  const [text, setText] = useState(() => ({ min: showBound(value.min), max: showBound(value.max) }));
  const parsed = { min: parseBound(text.min), max: parseBound(text.max) };
  if (parsed.min !== value.min || parsed.max !== value.max) {
    setText({ min: showBound(value.min), max: showBound(value.max) });
  }
  const inverted = value.min !== null && value.max !== null && value.min > value.max;
  const set = (field: "min" | "max", t: string) => {
    const next = { ...text, [field]: t };
    setText(next);
    onChange({ min: parseBound(next.min), max: parseBound(next.max) });
  };
  const input = (field: "min" | "max") => (
    <input
      type="text"
      inputMode="decimal"
      enterKeyHint="done"
      name={`explorateur-${id}-${field}`}
      autoComplete="off"
      data-lpignore="true"
      data-1p-ignore="true"
      spellCheck={false}
      placeholder={field === "min" ? "Min" : "Max"}
      aria-label={`${label} ${field === "min" ? "minimum" : "maximum"}${unit ? ` (${unit})` : ""}`}
      aria-invalid={inverted || undefined}
      aria-describedby={inverted ? `${id}-err` : undefined}
      value={text[field]}
      onChange={(e) => set(field, e.target.value)}
      className={`${FIELD} tabular-nums ${inverted ? "border-rose-400/60" : ""}`}
    />
  );
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
        {unit ? <span className="normal-case tracking-normal text-slate-500"> ({unit})</span> : null}
      </legend>
      <div className="flex items-center gap-2">
        {input("min")}
        <span aria-hidden="true" className="text-slate-600">
          –
        </span>
        {input("max")}
      </div>
      {inverted ? (
        <p id={`${id}-err`} className="mt-1 text-xs text-rose-300">
          Le minimum dépasse le maximum.
        </p>
      ) : null}
    </fieldset>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <label className={LABEL}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)} className={`${FIELD} normal-case tracking-normal`}>
        {children}
      </select>
    </label>
  );
}

function Toggle({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  /** What exactly the toggle keeps out (tooltip and description). */
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const hintId = useId();
  return (
    <>
      <label
        title={title}
        className={`${CHIP} gap-2 ${
          checked ? "border-cyan-400/50 bg-cyan-500/15 text-cyan-100" : "border-white/15 bg-white/5 text-slate-300"
        }`}
      >
        <input
          type="checkbox"
          checked={checked}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-cyan-400"
        />
        {label}
      </label>
      {/* Outside the label, so it describes the checkbox without lengthening its name. */}
      <span id={hintId} className="sr-only">
        {title}
      </span>
    </>
  );
}

export interface ExplorerFiltersProps {
  view: ExplorerView;
  caps: ExplorerCapabilities;
  presets: ExplorerPreset[];
  teams: Array<{ id: string; name: string }>;
  teamId: string;
  nhlTeams: string[];
  phases: string[];
  verdicts: string[];
  trends: string[];
  draftOpen: boolean;
  nextPick: number | null;
  onFilters: (patch: Partial<Filters>) => void;
  onPreset: (p: ExplorerPreset) => void;
  onReset: () => void;
  onColumns: (cols: ColumnKey[]) => void;
  visible: ColumnKey[];
}

/** Presets, the filter form, the column chooser and « Réinitialiser ». */
export function ExplorerFilters({
  view,
  caps,
  presets,
  teams,
  teamId,
  nhlTeams,
  phases,
  verdicts,
  trends,
  draftOpen,
  nextPick,
  onFilters,
  onPreset,
  onReset,
  onColumns,
  visible,
}: ExplorerFiltersProps) {
  const f = view.filters;
  const moreId = useId();
  const colsId = useId();
  const advancedCount =
    [f.fp, f.fpg, f.ros, f.adp, f.pNhl, f.eta, f.dyn].filter((r) => r.min !== null || r.max !== null).length +
    [f.verdict, f.trend, f.phase].filter(Boolean).length;
  // Open by default when a bookmarked view carries advanced filters; the
  // user's own toggle wins from then on.
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const panelId = useId();
  const showMore = moreOpen ?? advancedCount > 0;
  const active = activeFilterCount(f);
  const atDefaults = active === 0 && view.sort.key === DEFAULT_VIEW.sort.key && view.sort.dir === DEFAULT_VIEW.sort.dir;
  const hasDyn = caps.dynasty.size > 0;
  const available = COLUMN_KEYS.filter((c) => columnAvailable(c, caps));
  const toggleColumn = (c: ColumnKey, on: boolean) => {
    const set = new Set(visible);
    if (on) set.add(c);
    else set.delete(c);
    onColumns(COLUMN_KEYS.filter((k) => set.has(k)));
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 id="explorateur-vues" className="text-xs font-medium uppercase tracking-wider text-slate-400">
          Vues rapides
        </h3>
        <ul aria-labelledby="explorateur-vues" className="mt-2 flex flex-wrap gap-2">
          {presets.map((p) => {
            const on = matchesPreset(view, p);
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

      <form role="search" aria-label="Filtres des joueurs" onSubmit={(e) => e.preventDefault()} className="space-y-4">
        <div className="flex items-end gap-2">
          <label className={`${LABEL} flex-1`}>
            Nom
            <input
              id={SEARCH_INPUT_ID}
              type="search"
              inputMode="search"
              enterKeyHint="search"
              name="explorateur-recherche"
              autoComplete="off"
              data-lpignore="true"
              data-1p-ignore="true"
              spellCheck={false}
              placeholder="Rechercher un joueur ou une équipe LNH"
              value={f.q}
              onChange={(e) => onFilters({ q: e.target.value })}
              className={`${FIELD} normal-case tracking-normal`}
            />
          </label>
          {/* Phones: the other filters fold away so the table stays close. */}
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls={panelId}
            onClick={() => setPanelOpen((o) => !o)}
            className={`${BUTTON} shrink-0 sm:hidden`}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            Filtres
            {active > 0 ? (
              <span className="rounded-full bg-cyan-500/20 px-1.5 text-xs tabular-nums text-cyan-100">
                {active}
                <span className="sr-only"> {active > 1 ? "actifs" : "actif"}</span>
              </span>
            ) : null}
          </button>
        </div>

        <div id={panelId} className={`space-y-4 ${panelOpen ? "" : "max-sm:hidden"}`}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Statut" value={f.status} onChange={(v) => onFilters({ status: v })}>
              <option value="tous">Tous les joueurs</option>
              <option value="dispo">{draftOpen ? "Disponibles au repêchage" : "Disponibles (autonomes et ballottage)"}</option>
              <option value="fa">Joueurs autonomes (FA)</option>
              <option value="ww">Au ballottage (WW)</option>
              <option value="pris">Pris par une équipe</option>
              <option value="moi">Mon équipe</option>
              <optgroup label="Une équipe précise">
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                    {t.id === teamId ? " (mon équipe)" : ""}
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
                {EXPLORER_TYPES.map((t) => (
                  <label
                    key={t}
                    className={`flex flex-1 cursor-pointer items-center justify-center rounded-lg px-2 text-sm transition motion-reduce:transition-none focus-within:ring-2 focus-within:ring-cyan-400 ${
                      f.type === t ? "bg-cyan-500/20 font-semibold text-cyan-100" : "text-slate-300 hover:text-white"
                    }`}
                  >
                    <input
                      type="radio"
                      name="explorateur-type"
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
                  title="Sans les joueurs sans club LNH, assignés aux mineures, sans contrat, suspendus, inactifs, blessés ou absents des listes de Fantrax (comme les panneaux Repêchage et Ballottage)"
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
            <button
              type="button"
              aria-expanded={colsOpen}
              aria-controls={colsId}
              onClick={() => setColsOpen((o) => !o)}
              className={BUTTON}
            >
              <Columns3 className="h-4 w-4" aria-hidden="true" />
              Colonnes
            </button>
            {/* aria-disabled, not disabled: the button stays focused once the view is back to the defaults. */}
            <button
              type="button"
              onClick={() => {
                if (!atDefaults) onReset();
              }}
              aria-disabled={atDefaults || undefined}
              className={`${BUTTON} aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-white/15`}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Réinitialiser
              {active > 0 ? (
                <span className="rounded-full bg-cyan-500/20 px-1.5 text-xs tabular-nums text-cyan-100">
                  {active}
                  <span className="sr-only"> {active > 1 ? "filtres actifs" : "filtre actif"}</span>
                </span>
              ) : null}
            </button>
          </div>

          <div id={moreId} hidden={!showMore} className="grid gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-2 lg:grid-cols-4">
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
            {!hasDyn && !caps.snake ? (
              <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">
                {"Les filtres dynastie (phase, P(LNH), ETA) et Snake (verdict, tendance) apparaissent quand ces données sont publiées."}
              </p>
            ) : null}
          </div>

          <fieldset id={colsId} hidden={!colsOpen} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <legend className="px-1 text-xs font-medium uppercase tracking-wider text-slate-400">Colonnes affichées</legend>
            <div className="flex flex-wrap gap-2">
              {available.map((c) => {
                const copy = columnCopy(c, nextPick);
                const on = visible.includes(c);
                return (
                  <label
                    key={c}
                    title={copy.title}
                    className={`${CHIP} gap-2 ${on ? "border-cyan-400/40 bg-cyan-500/10 text-cyan-100" : "border-white/15 bg-white/5 text-slate-400"}`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) => toggleColumn(c, e.target.checked)}
                      className="h-4 w-4 accent-cyan-400"
                    />
                    {copy.label}
                  </label>
                );
              })}
            </div>
          </fieldset>
        </div>
      </form>
    </div>
  );
}
