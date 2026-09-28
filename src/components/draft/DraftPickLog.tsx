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
  /** Name the player of a « hors liste » pick (the board list then looks for him). */
  onIdentify?: (index: number) => void;
}

const SHOWN = 12;

/**
 * Latest picks first. « moi / autre » flips who made the pick; × removes a
 * mis-marked pick anywhere in the draft. Both are undoable (Annuler /
 * Ctrl + Z restore the previous state, whatever the action). Every
 * « hors liste » pick, however old, can be named (« Identifier »): the
 * list now holds every player.
 */
export function DraftPickLog({ picks, byId, teams, slot, onRemove, onToggleMine, onIdentify }: DraftPickLogProps) {
  const indexed = picks.map((pick, index) => ({ pick, index }));
  const recent = indexed.slice(-SHOWN).reverse();
  // Older « hors liste » picks (mine first): the recent list shows the others.
  const olderUnlisted = indexed
    .slice(0, Math.max(0, picks.length - SHOWN))
    .filter(({ pick }) => pick.id === UNLISTED_PLAYER_ID)
    .sort((a, b) => Number(b.pick.mine) - Number(a.pick.mine) || a.index - b.index);
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
                {pick.id === UNLISTED_PLAYER_ID && onIdentify ? (
                  <IdentifyButton label={pickLabel(n)} onClick={() => onIdentify(index)} />
                ) : null}
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
      {onIdentify && olderUnlisted.length > 0 ? (
        // Open when one of them is mine (Mon équipe misses him); other teams' only matter for « Disponibles ».
        <details className="mt-3" open={olderUnlisted.some(({ pick }) => pick.mine)}>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400">
            Choix hors liste plus anciens ({olderUnlisted.length})
          </summary>
          <ul className="mt-1 space-y-1.5">
            {olderUnlisted.map(({ pick, index }) => (
              <li key={`u-${index}`} className="flex items-center gap-2 text-sm">
                <span className="w-12 shrink-0 text-xs tabular-nums text-slate-500">{pickLabel(index + 1)}</span>
                <span className={`min-w-0 flex-1 truncate ${pick.mine ? "font-semibold text-cyan-200" : "text-slate-300"}`}>
                  Joueur hors liste <span className="text-xs font-normal text-slate-500">({pick.mine ? "moi" : "autre"})</span>
                </span>
                <IdentifyButton label={pickLabel(index + 1)} onClick={() => onIdentify(index)} />
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {picks.length > SHOWN ? (
        <p className="mt-2 text-xs text-slate-500">
          {picks.length - SHOWN} choix plus anciens : « Voir repêchés » dans le tableau pour les retirer.
        </p>
      ) : null}
    </section>
  );
}

function IdentifyButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 shrink-0 items-center rounded-md px-2 text-[11px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-300/40 hover:bg-amber-400/15 sm:min-h-8"
      aria-label={`Identifier le joueur du ${label} (hors liste)`}
      title="Nommer le joueur de ce choix (il garde son numéro et son équipe)"
    >
      Identifier
    </button>
  );
}
