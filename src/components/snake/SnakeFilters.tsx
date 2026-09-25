"use client";

import { Search } from "lucide-react";
import type { ReactNode } from "react";
import { formatCountFr, formatSnakeDate, stanceLabel, trendLabel } from "@/lib/snake/copy";
import { activeSnakeFilterCount, type SnakeFilterState, type SnakeSort } from "@/lib/snake/filters";
import { SNAKE_STANCES, SNAKE_TRENDS } from "@/lib/snake/types";

const SELECT_CLASS =
  "min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 px-3 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-slate-400">
      {label}
      {children}
    </label>
  );
}

const SORTS: Array<[SnakeSort, string]> = [
  ["opinions", "Nombre d'opinions"],
  ["recent", "Dernière mention"],
  ["verdict-pos", "Verdict (plus positif d'abord)"],
  ["verdict-neg", "Verdict (plus négatif d'abord)"],
  ["name", "Nom (A à Z)"],
];

const POSITIONS: Array<[SnakeFilterState["position"], string]> = [
  ["", "Toutes"],
  ["F", "Attaquants"],
  ["C", "Centres (C)"],
  ["LW", "Ailiers gauches (LW)"],
  ["RW", "Ailiers droits (RW)"],
  ["D", "Défenseurs (D)"],
  ["G", "Gardiens (G)"],
];

export interface SnakeFiltersProps {
  filters: SnakeFilterState;
  onChange: (patch: Partial<SnakeFilterState>) => void;
  onReset: () => void;
  shows: string[];
  teams: string[];
  seasons: string[];
  myTeamName: string;
  /** Roster players with Snake data (0 hides the checkbox). */
  myCount: number;
  searchRef?: React.Ref<HTMLInputElement>;
  /** Date of the data (YYYY-MM-DD): "last N days" count back from it. */
  dataDate: string;
}

/** Search box + every filter of the database (French, labelled controls). */
export function SnakeFilters({
  filters: f,
  onChange,
  onReset,
  shows,
  teams,
  seasons,
  myTeamName,
  myCount,
  searchRef,
  dataDate,
}: SnakeFiltersProps) {
  const active = activeSnakeFilterCount(f);
  // The data is rebuilt by hand, the site daily: say what "last 30 days" is relative to.
  const asOf = formatSnakeDate(dataDate);
  return (
    <form role="search" aria-label="Rechercher dans les opinions de Snake" onSubmit={(e) => e.preventDefault()} className="space-y-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-400">
        Rechercher un joueur
        <span className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            value={f.query}
            onChange={(e) => onChange({ query: e.target.value })}
            placeholder="Ex. : Hutson, Demidov, McKenna…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            data-1p-ignore
            data-lpignore="true"
            className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 pl-9 pr-3 text-base text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 sm:text-sm"
          />
        </span>
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Verdict">
          <select className={SELECT_CLASS} value={f.verdict} onChange={(e) => onChange({ verdict: e.target.value as SnakeFilterState["verdict"] })}>
            <option value="">Tous</option>
            {SNAKE_STANCES.map((s) => (
              <option key={s} value={s}>
                {stanceLabel(s)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Tendance">
          <select className={SELECT_CLASS} value={f.trend} onChange={(e) => onChange({ trend: e.target.value as SnakeFilterState["trend"] })}>
            <option value="">Toutes</option>
            {SNAKE_TRENDS.map((t) => (
              <option key={t} value={t}>
                {trendLabel(t)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Position">
          <select className={SELECT_CLASS} value={f.position} onChange={(e) => onChange({ position: e.target.value as SnakeFilterState["position"] })}>
            {POSITIONS.map(([v, l]) => (
              <option key={v || "all"} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Équipe LNH">
          <select className={SELECT_CLASS} value={f.team} onChange={(e) => onChange({ team: e.target.value })}>
            <option value="">Toutes</option>
            <option value="-">Sans équipe LNH</option>
            {teams.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Émission">
          <select className={SELECT_CLASS} value={String(f.show)} onChange={(e) => onChange({ show: Number(e.target.value) })}>
            <option value="-1">Toutes</option>
            {shows.map((s, i) => (
              <option key={s} value={String(i)}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Période">
          <select className={SELECT_CLASS} value={f.period} onChange={(e) => onChange({ period: e.target.value })}>
            <option value="">Depuis le début</option>
            <option value="30">{`30 jours avant le ${asOf}`}</option>
            <option value="90">{`3 mois avant le ${asOf}`}</option>
            <option value="365">{`12 mois avant le ${asOf}`}</option>
            {seasons.map((s) => (
              <option key={s} value={`s:${s}`}>
                Saison {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Trier par">
          <select className={SELECT_CLASS} value={f.sort} onChange={(e) => onChange({ sort: e.target.value as SnakeSort })}>
            {SORTS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex items-end">
          <button
            type="button"
            onClick={onReset}
            disabled={active === 0 && !f.query && f.sort === "opinions"}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 bg-white/5 px-3 text-sm font-medium text-slate-200 transition motion-reduce:transition-none hover:border-cyan-400/40 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Réinitialiser{active > 0 ? ` (${active})` : ""}
          </button>
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Base à jour au <time dateTime={dataDate}>{asOf}</time> : les périodes sont comptées à partir de cette date.
      </p>
      {myCount > 0 ? (
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={f.mine}
            onChange={(e) => onChange({ mine: e.target.checked })}
            className="h-5 w-5 rounded border-white/20 bg-slate-900 accent-cyan-400"
          />
          Seulement les joueurs de l&apos;équipe Fantrax {myTeamName} ({formatCountFr(myCount)})
        </label>
      ) : null}
    </form>
  );
}
