import { memo } from "react";
import { availabilityBand } from "@/lib/draft/availability";
import type { DraftBoard, DraftBoardPlayer } from "@/lib/draft/board-types";
import { groupRelativeZ, isGoalieBoardPlayer } from "@/lib/draft/board-types";
import {
  formatFr,
  formatPercentFr,
  pickLabel,
  yearsLabel,
} from "@/lib/draft/draft-copy";
import type { LeagueCategory } from "@/lib/leagues/types";
import { CategoryMiniBars } from "./CategoryMiniBars";
import { DraftPositionBadges } from "./DraftPositionBadges";

export interface DraftPlayerRowProps {
  player: DraftBoardPlayer;
  rankLabel: number;
  skaterCategories: readonly LeagueCategory[];
  goalieCategories: readonly LeagueCategory[];
  /** P(available at the pick the column is about); null = no slot yet. */
  availability: number | null;
  pickNumber: number | null;
  pickIndex: number;
  mine: boolean;
  active: boolean;
  /** Our pick is on: « Moi » becomes the emphasised action (and Entrée). */
  onTheClock: boolean;
  skaterGroupOffset: DraftBoard["skaterGroupOffset"];
  rowId: string;
  onMark: (id: number, mine: boolean) => void;
  onRemove: (index: number) => void;
}

const NBSP = String.fromCharCode(0xa0);

const BAND_CLASS = {
  yes: "text-emerald-300",
  maybe: "text-amber-300",
  no: "text-rose-300",
} as const;

/**
 * One board row. Two lines below xl (name/VOR, then bars/ADP/availability
 * and the actions), one line on xl where the meta wrapper becomes
 * `display: contents` so its children align as table columns.
 */
export const DraftPlayerRow = memo(function DraftPlayerRow({
  player: p,
  rankLabel,
  skaterCategories,
  goalieCategories,
  availability,
  pickNumber,
  pickIndex,
  mine,
  active,
  onTheClock,
  skaterGroupOffset,
  rowId,
  onMark,
  onRemove,
}: DraftPlayerRowProps) {
  const drafted = pickNumber != null;
  const goalie = isGoalieBoardPlayer(p);
  const band = availability == null ? null : availabilityBand(availability);
  return (
    <li
      id={rowId}
      className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 border-b border-white/5 px-2 py-2 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto] sm:gap-x-3 sm:px-3 xl:grid-cols-[2.5rem_minmax(0,1fr)_4.25rem_6.5rem_3.5rem_4rem_11rem] ${
        drafted ? "opacity-45" : ""
      } ${active ? "bg-cyan-500/10 ring-1 ring-inset ring-cyan-400/50" : ""}`}
    >
      <div className="row-span-2 self-start pt-0.5 text-right text-xs tabular-nums text-slate-500 xl:row-span-1 xl:self-center xl:pt-0">
        {rankLabel}
      </div>

      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={`truncate font-semibold ${drafted ? "text-slate-400 line-through" : "text-white"}`}
          >
            {p.name}
          </span>
          <DraftPositionBadges positions={p.pos} vorPos={p.vorPos} />
        </div>
        <div className="truncate text-xs text-slate-400">
          {p.team}
          {p.age != null ? ` · ${yearsLabel(p.age)}` : ""}
          {` · ${p.gp}${NBSP}PJ`}
          {drafted ? (
            <span className={mine ? "text-cyan-300" : "text-slate-300"}>
              {` · ${mine ? "Mon choix" : "Repêché"} ${pickLabel(pickNumber)}`}
            </span>
          ) : null}
        </div>
      </div>

      <div className="text-right xl:col-start-3 xl:row-start-1">
        <div className="text-base font-bold tabular-nums text-cyan-200">{formatFr(p.vor, 1)}</div>
        <div className="text-[10px] uppercase tracking-wide text-slate-500 xl:hidden">VOR</div>
      </div>

      <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-3 text-xs xl:contents">
        <div className="xl:col-start-4 xl:row-start-1">
          <CategoryMiniBars
            categories={goalie ? goalieCategories : skaterCategories}
            z={groupRelativeZ({ skaterGroupOffset }, p)}
            proj={p.proj}
          />
        </div>
        <div className="tabular-nums text-slate-400 xl:col-start-5 xl:row-start-1 xl:text-right">
          <span className="xl:hidden">ADP </span>
          {p.adp != null ? formatFr(p.adp, 0) : "—"}
        </div>
        <div
          className={`tabular-nums xl:col-start-6 xl:row-start-1 xl:text-right ${band ? BAND_CLASS[band] : "text-slate-500"}`}
          title="Probabilité qu’il soit encore disponible (proxy ADP)"
        >
          <span className="xl:hidden">Dispo </span>
          {availability == null || drafted ? "—" : formatPercentFr(availability)}
        </div>
      </div>

      <div className="col-start-3 row-start-2 flex justify-end gap-1.5 xl:col-start-7 xl:row-start-1">
        {drafted ? (
          <button
            type="button"
            onClick={() => onRemove(pickIndex)}
            className="min-h-11 rounded-lg border border-white/15 px-3 text-xs font-medium text-slate-200 hover:border-white/30 hover:bg-white/5 sm:min-h-9"
            aria-label={`Annuler le choix ${pickLabel(pickNumber)} : ${p.name}`}
          >
            Remettre
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onMark(p.id, false)}
              className={`min-h-11 min-w-11 rounded-lg px-2 text-xs font-medium sm:min-h-9 sm:px-3 ${
                onTheClock
                  ? "border border-white/15 text-slate-300 hover:border-rose-300/50 hover:bg-rose-500/10"
                  : "border border-white/25 bg-slate-700 text-white hover:bg-slate-600"
              }`}
              aria-label={`${p.name} : repêché par une autre équipe`}
              title={`Repêché par une autre équipe (${onTheClock ? "Maj + Entrée" : "Entrée"})`}
            >
              <span className="sm:hidden">Pris</span>
              <span className="hidden sm:inline">Repêché</span>
            </button>
            <button
              type="button"
              onClick={() => onMark(p.id, true)}
              className={`min-h-11 min-w-11 rounded-lg px-2 text-xs font-semibold sm:min-h-9 sm:px-3 ${
                onTheClock
                  ? "bg-amber-400 text-slate-950 hover:bg-amber-300"
                  : "border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/10"
              }`}
              aria-label={`${p.name} : ajouter à mon équipe`}
              title={`Mon choix (${onTheClock ? "Entrée" : "Maj + Entrée"})`}
            >
              <span className="sm:hidden">Moi</span>
              <span className="hidden sm:inline">Mon choix</span>
            </button>
          </>
        )}
      </div>
    </li>
  );
});
