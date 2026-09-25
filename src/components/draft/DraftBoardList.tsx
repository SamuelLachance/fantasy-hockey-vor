"use client";

import { Search } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { DRAFT_FILTERS, draftFilterLabel, displayRank, type DraftFilter, type DraftRow } from "@/lib/draft/board-filter";
import type { DraftBoard } from "@/lib/draft/board-types";
import { CATEGORY_SHORT, pickLabel } from "@/lib/draft/draft-copy";
import type { LeagueCategory } from "@/lib/leagues/types";
import { DraftPlayerRow } from "./DraftPlayerRow";

interface DraftBoardListProps {
  rows: DraftRow[];
  limit: number;
  onShowMore: () => void;
  skaterCategories: readonly LeagueCategory[];
  goalieCategories: readonly LeagueCategory[];
  filter: DraftFilter;
  onFilter: (f: DraftFilter) => void;
  query: string;
  onQuery: (q: string) => void;
  onSearchKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  showDrafted: boolean;
  onToggleDrafted: () => void;
  /** Index in `rows` of the highlighted (always undrafted) row; -1 = none. */
  activeIndex: number;
  /** Our pick is on: Entrée / the emphasised row action mean "mon choix". */
  onTheClock: boolean;
  skaterGroupOffset: DraftBoard["skaterGroupOffset"];
  availabilityFor: (row: DraftRow) => number | null;
  /** Pick the availability column is about (null → no slot entered). */
  availabilityPick: number | null;
  onMark: (id: number, mine: boolean) => void;
  onRemove: (index: number) => void;
  onUnlisted: () => void;
  remaining: number;
}

export function draftRowId(id: number): string {
  return `draft-row-${id}`;
}

export function DraftBoardList({
  rows,
  limit,
  onShowMore,
  skaterCategories,
  goalieCategories,
  filter,
  onFilter,
  query,
  onQuery,
  onSearchKeyDown,
  searchRef,
  showDrafted,
  onToggleDrafted,
  activeIndex,
  onTheClock,
  skaterGroupOffset,
  availabilityFor,
  availabilityPick,
  onMark,
  onRemove,
  onUnlisted,
  remaining,
}: DraftBoardListProps) {
  const shown = rows.slice(0, limit);
  const activeRow = activeIndex >= 0 ? rows[activeIndex] : undefined;
  const hasQuery = query.trim() !== "";
  return (
    <section
      aria-labelledby="draft-board-heading"
      className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/60"
    >
      <div className="z-10 space-y-2 rounded-t-2xl lg:sticky lg:top-0 border-b border-white/10 bg-slate-950/95 p-3 backdrop-blur motion-reduce:backdrop-blur-none">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="draft-board-heading" className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Tableau VOR
          </h2>
          <p className="text-xs text-slate-500">
            {remaining} disponibles · {rows.length} affichés
          </p>
        </div>
        {availabilityPick != null ? (
          <p className="text-[11px] text-slate-500">
            Dispo = chance qu’il soit encore là à votre {pickLabel(availabilityPick)} (ADP Fantrax, approximatif).
          </p>
        ) : null}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Chercher un joueur ou une équipe"
            aria-label="Chercher un joueur ou une équipe"
            aria-describedby="draft-search-hint"
            aria-activedescendant={activeRow && hasQuery ? draftRowId(activeRow.player.id) : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            data-1p-ignore
            data-lpignore="true"
            className="min-h-11 w-full rounded-xl border border-white/15 bg-slate-900 pl-9 pr-3 text-base text-white placeholder:text-slate-500 focus:border-cyan-400/60 sm:text-sm"
          />
          <p id="draft-search-hint" className="sr-only">
            {onTheClock
              ? "C’est à vous : Entrée ajoute le joueur surligné à mon équipe, Majuscule + Entrée le marque repêché par une autre équipe."
              : "Entrée : le joueur surligné est repêché par une autre équipe. Majuscule + Entrée : mon choix."}{" "}
            Flèches : changer de joueur. Sur un téléphone, la touche OK ferme seulement le clavier.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <div role="group" aria-label="Filtrer par position" className="flex flex-wrap gap-1">
            {DRAFT_FILTERS.map((f, i) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => onFilter(f)}
                title={`${draftFilterLabel(f)} (${i + 1})`}
                className={`min-h-9 min-w-9 rounded-lg px-2.5 text-xs font-semibold transition motion-reduce:transition-none ${
                  filter === f
                    ? "bg-cyan-500 text-slate-950"
                    : "border border-white/10 text-slate-300 hover:border-white/25 hover:text-white"
                }`}
              >
                {draftFilterLabel(f)}
              </button>
            ))}
          </div>
          <div className="ml-auto flex flex-wrap gap-1">
            <button
              type="button"
              aria-pressed={showDrafted}
              onClick={onToggleDrafted}
              title="Afficher les joueurs repêchés"
              className="min-h-9 rounded-lg border border-white/10 px-2.5 text-xs text-slate-300 hover:border-white/25 hover:text-white"
            >
              {showDrafted ? "Masquer repêchés" : "Voir repêchés"}
            </button>
            <button
              type="button"
              onClick={onUnlisted}
              title="Un joueur absent du tableau vient d’être repêché : avance le compteur d’un choix"
              className="min-h-9 rounded-lg border border-white/10 px-2.5 text-xs text-slate-300 hover:border-white/25 hover:text-white"
            >
              + Hors liste
            </button>
          </div>
        </div>
        <div
          aria-hidden="true"
          className="hidden grid-cols-[2.5rem_minmax(0,1fr)_4.25rem_6.5rem_3.5rem_4rem_11rem] gap-x-3 px-3 text-[10px] uppercase tracking-wider text-slate-500 xl:grid"
        >
          <span className="text-right">{filter === "ALL" ? "Rg" : `Rg ${filter}`}</span>
          <span>Joueur</span>
          <span className="text-right">VOR</span>
          <span>
            {filter === "G"
              ? goalieCategories.map((c) => CATEGORY_SHORT[c]).join(" ")
              : "z vs pairs"}
          </span>
          <span className="text-right">ADP</span>
          <span className="text-right" title="Probabilité qu’il soit encore là">
            {availabilityPick ? `Dispo ${pickLabel(availabilityPick)}` : "Dispo"}
          </span>
          <span className="text-right">Actions</span>
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-slate-400">
          Aucun joueur ne correspond.{" "}
          {query ? (
            <button type="button" className="text-cyan-300 underline" onClick={() => onQuery("")}>
              Vider la recherche
            </button>
          ) : null}
        </p>
      ) : (
        <ol aria-label="Joueurs triés par VOR" className="min-w-0">
          {shown.map((row, i) => (
            <DraftPlayerRow
              key={row.player.id}
              rowId={draftRowId(row.player.id)}
              player={row.player}
              rankLabel={displayRank(row.player, filter)}
              skaterCategories={skaterCategories}
              goalieCategories={goalieCategories}
              availability={availabilityFor(row)}
              pickNumber={row.pickNumber}
              pickIndex={row.pickIndex}
              mine={row.mine}
              active={i === activeIndex && hasQuery}
              onTheClock={onTheClock}
              skaterGroupOffset={skaterGroupOffset}
              onMark={onMark}
              onRemove={onRemove}
            />
          ))}
        </ol>
      )}
      {rows.length > limit ? (
        <div className="p-3 text-center">
          <button
            type="button"
            onClick={onShowMore}
            className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-slate-200 hover:border-white/30 hover:bg-white/5"
          >
            Afficher {Math.min(80, rows.length - limit)} de plus ({rows.length - limit} restants)
          </button>
        </div>
      ) : null}
    </section>
  );
}
