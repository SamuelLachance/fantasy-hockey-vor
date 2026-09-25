import { X } from "lucide-react";
import type { DraftBoardPlayer } from "@/lib/draft/board-types";
import { pickLabel, pickOwnerMismatch } from "@/lib/draft/draft-copy";
import { UNLISTED_PLAYER_ID, type DraftPick } from "@/lib/draft/draft-state";
import { pickInfo } from "@/lib/draft/snake";

interface DraftPickLogProps {
  picks: DraftPick[];
  byId: Map<number, DraftBoardPlayer>;
  teams: number;
  /** Our draft slot (flags picks whose owner contradicts the snake order). */
  slot: number | null;
  onRemove: (index: number) => void;
  onToggleMine: (index: number) => void;
}

const SHOWN = 12;

/**
 * Latest picks first. « moi / autre » flips who made the pick; × removes a
 * mis-marked pick anywhere in the draft. Both are undoable (Annuler /
 * Ctrl + Z restore the previous state, whatever the action).
 */
export function DraftPickLog({ picks, byId, teams, slot, onRemove, onToggleMine }: DraftPickLogProps) {
  const recent = picks
    .map((pick, index) => ({ pick, index }))
    .slice(-SHOWN)
    .reverse();
  return (
    <section aria-labelledby="draft-log-heading" className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <h2 id="draft-log-heading" className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        Derniers choix
      </h2>
      {recent.length === 0 ? (
        <p className="text-sm text-slate-400">Aucun choix marqué.</p>
      ) : (
        <ol className="space-y-1.5">
          {recent.map(({ pick, index }) => {
            const p = pick.id === UNLISTED_PLAYER_ID ? null : byId.get(pick.id);
            const name = p ? p.name : "Joueur hors liste";
            const n = index + 1;
            const owner = pickInfo(n, teams).slot;
            const mismatch = pickOwnerMismatch(owner, slot, pick.mine);
            return (
              <li key={`${index}-${pick.id}`} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 text-xs tabular-nums text-slate-500">{pickLabel(n)}</span>
                <span className={`min-w-0 flex-1 truncate ${pick.mine ? "font-semibold text-cyan-200" : "text-slate-300"}`}>
                  {name}
                  {p ? <span className="text-xs text-slate-500"> {p.pos.join("/")}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={() => onToggleMine(index)}
                  aria-pressed={pick.mine}
                  className={`inline-flex min-h-10 shrink-0 items-center rounded-md px-2 text-[11px] sm:min-h-8 ${
                    mismatch
                      ? "bg-amber-400/15 text-amber-200 ring-1 ring-inset ring-amber-300/50 hover:bg-amber-400/25"
                      : "text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                  aria-label={`${pickLabel(n)} (${name}) : ${pick.mine ? "mon choix" : "autre équipe"}${
                    mismatch ? `, mais ce choix appartient à la position ${owner}` : ""
                  }. Basculer en ${pick.mine ? "autre équipe" : "mon choix"}`}
                  title={
                    mismatch
                      ? `Le ${pickLabel(n)} appartient à la position ${owner} : cliquer pour corriger`
                      : "Basculer mon choix / autre équipe"
                  }
                >
                  {pick.mine ? "moi" : "autre"}
                  {mismatch ? " ?" : ""}
                </button>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-white/10 hover:text-white sm:min-h-8 sm:min-w-8"
                  aria-label={`Retirer le choix ${pickLabel(n)} (${name})`}
                  title="Retirer ce choix (annulable)"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {picks.length > SHOWN ? (
        <p className="mt-2 text-xs text-slate-500">
          {picks.length - SHOWN} choix plus anciens : « Voir repêchés » dans le tableau pour les retirer.
        </p>
      ) : null}
    </section>
  );
}
