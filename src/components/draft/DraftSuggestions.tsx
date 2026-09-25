import { Sparkles } from "lucide-react";
import { availabilityBand } from "@/lib/draft/availability";
import { isGoalieBoardPlayer } from "@/lib/draft/board-types";
import {
  CATEGORY_SHORT,
  SLOT_FR,
  formatFr,
  formatPercentFr,
  formatSignedFr,
  formatStat,
  pickLabel,
} from "@/lib/draft/draft-copy";
import type { DraftTimeline, Suggestion } from "@/lib/draft/suggestions";
import type { LeagueCategory } from "@/lib/leagues/types";
import { DraftPositionBadges } from "./DraftPositionBadges";

interface DraftSuggestionsProps {
  suggestions: Suggestion[];
  timeline: DraftTimeline;
  hasSlot: boolean;
  skaterCategories: readonly LeagueCategory[];
  goalieCategories: readonly LeagueCategory[];
  onMark: (id: number, mine: boolean) => void;
}

const BAND_CLASS = {
  yes: "bg-emerald-500/15 text-emerald-200",
  maybe: "bg-amber-500/15 text-amber-200",
  no: "bg-rose-500/15 text-rose-200",
} as const;

export function DraftSuggestions({
  suggestions,
  timeline,
  hasSlot,
  skaterCategories,
  goalieCategories,
  onMark,
}: DraftSuggestionsProps) {
  const { onTheClock, targetPick, draftOver } = timeline;
  return (
    <section
      aria-labelledby="draft-suggestions-heading"
      className={`rounded-2xl border p-3 sm:p-4 ${
        onTheClock ? "border-amber-300/50 bg-amber-400/5" : "border-white/10 bg-white/5"
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2
          id="draft-suggestions-heading"
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-200"
        >
          <Sparkles className="h-4 w-4 text-amber-300" aria-hidden="true" />
          Suggestions
        </h2>
        <p className="text-xs text-slate-400">
          {draftOver
            ? "Repêchage terminé"
            : onTheClock
              ? `À vous, ${pickLabel(targetPick!)}`
              : targetPick != null
                ? `Pour votre ${pickLabel(targetPick)}`
                : "Choix actuel"}
        </p>
      </div>
      {!hasSlot && !draftOver ? (
        <p className="mb-2 rounded-lg bg-amber-500/10 px-2 py-1.5 text-xs text-amber-100">
          Entrez « Ma position » pour tenir compte de vos prochains choix (rareté, disponibilité).
        </p>
      ) : null}
      {suggestions.length === 0 ? (
        <p className="text-sm text-slate-400">Aucune suggestion.</p>
      ) : (
        <ol className="space-y-2">
          {suggestions.map((s, i) => {
            const p = s.player;
            const goalie = isGoalieBoardPlayer(p);
            const cats = goalie ? goalieCategories : skaterCategories;
            const band = availabilityBand(s.availability);
            return (
              <li key={p.id} className="rounded-xl border border-white/10 bg-slate-950/60 p-2.5">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 w-4 shrink-0 text-right text-xs font-bold text-amber-300">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="truncate font-semibold text-white">{p.name}</span>
                      <DraftPositionBadges positions={p.pos} vorPos={p.vorPos} />
                      <span className="hidden text-xs text-slate-400 sm:inline">{p.team}</span>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-slate-400">
                      {cats.map((c, k) => `${CATEGORY_SHORT[c]} ${formatStat(c, p.proj[k] ?? 0)}`).join(" · ")}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-300">
                      <span className="font-semibold text-cyan-200">
                        Score {formatFr(s.score, 1)}
                      </span>
                      <span title="Gain pour votre alignement (VOR au poste occupé, part de banc sinon)">
                        {formatSignedFr(s.gain)} alignement
                      </span>
                      {s.scarcity > 0.05 ? (
                        <span title="Écart avec le meilleur joueur attendu au même poste à votre choix suivant">
                          {formatSignedFr(s.scarcity)} rareté
                        </span>
                      ) : null}
                      {s.balance > 0.05 ? (
                        <span title="Ce qu’il ajoute dans vos catégories faibles (par rapport au joueur moyen de ce poste)">
                          {formatSignedFr(s.balance)} équilibre
                        </span>
                      ) : null}
                      <span className="rounded bg-white/10 px-1.5 py-px text-slate-200">
                        → {s.seatedAs ? SLOT_FR[s.seatedAs] : "hors alignement"}
                      </span>
                      {!onTheClock && targetPick != null ? (
                        <span
                          className={`rounded px-1.5 py-px ${BAND_CLASS[band]}`}
                          title={`Probabilité qu’il soit encore là à votre ${pickLabel(targetPick)} (ADP Fantrax, approximatif)`}
                        >
                          {formatPercentFr(s.availability)} dispo
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1">
                    {/* Emphasis follows the clock: 11 picks in 12 belong to
                        other teams, so "Mon choix" is only the loud button
                        when it is actually our turn. */}
                    <button
                      type="button"
                      onClick={() => onMark(p.id, true)}
                      className={`min-h-10 rounded-lg px-3 text-xs font-semibold ${
                        onTheClock
                          ? "bg-amber-400 text-slate-950 hover:bg-amber-300"
                          : "border border-cyan-400/40 text-cyan-200 hover:bg-cyan-500/10"
                      }`}
                      aria-label={`${p.name} : ajouter à mon équipe`}
                    >
                      Mon choix
                    </button>
                    <button
                      type="button"
                      onClick={() => onMark(p.id, false)}
                      className={`min-h-10 rounded-lg px-3 text-xs ${
                        onTheClock
                          ? "border border-white/15 text-slate-300 hover:border-rose-300/50 hover:bg-rose-500/10"
                          : "border border-white/25 bg-slate-700 text-white hover:bg-slate-600"
                      }`}
                      aria-label={`${p.name} : repêché par une autre équipe`}
                    >
                      Repêché
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
