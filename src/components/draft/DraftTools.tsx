"use client";

import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { parseDraftState, serializeDraftState, type DraftState } from "@/lib/draft/draft-state";

interface DraftToolsProps {
  slug: string;
  teams: number;
  state: DraftState;
  knownIds: ReadonlySet<number>;
  persistent: boolean;
  onImport: (next: DraftState) => void;
  onReset: () => void;
}

/**
 * Export / import the draft as one line of text (move it to another device
 * mid-draft, or keep a copy) and a two-step reset.
 */
export function DraftTools({ slug, teams, state, knownIds, persistent, onImport, onReset }: DraftToolsProps) {
  const exported = serializeDraftState(state, slug);
  // Tied to the exact text copied: after another pick the label falls back
  // to « Copier », so a stale clipboard is never presented as current.
  const [copied, setCopied] = useState<{ text: string; ok: boolean } | null>(null);
  const copyState = copied?.text === exported ? (copied.ok ? "ok" : "fail") : null;
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [armed, setArmed] = useState(false);

  return (
    <section aria-labelledby="draft-tools-heading" className="rounded-2xl border border-white/10 bg-white/5 p-3 sm:p-4">
      <h2 id="draft-tools-heading" className="mb-2 text-sm font-semibold uppercase tracking-wider text-slate-200">
        Sauvegarde
      </h2>
      <p className="mb-3 text-xs text-slate-400">
        {persistent
          ? "Le repêchage est enregistré dans ce navigateur (rechargez sans crainte)."
          : "Stockage local indisponible : le repêchage n’est pas enregistré. Exportez-le au besoin."}
      </p>

      <label className="block text-xs font-semibold text-slate-300" htmlFor="draft-export">
        Exporter (texte)
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id="draft-export"
          readOnly
          value={exported}
          onFocus={(e) => e.currentTarget.select()}
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-white/15 bg-slate-900 px-2 font-mono text-xs text-slate-200"
        />
        <button
          type="button"
          onClick={async () => setCopied({ text: exported, ok: await copyText(exported) })}
          className="min-h-10 shrink-0 rounded-lg border border-white/15 px-3 text-xs text-slate-200 hover:border-white/30 hover:bg-white/5"
        >
          {copyState === "ok"
            ? `Copié (${state.picks.length} choix)`
            : copyState === "fail"
              ? "Échec"
              : `Copier (${state.picks.length} choix)`}
        </button>
      </div>

      <label className="mt-3 block text-xs font-semibold text-slate-300" htmlFor="draft-import">
        Importer
      </label>
      <textarea
        id="draft-import"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder={`repechage:${slug}:v1;position=…;choix=…`}
        spellCheck={false}
        autoComplete="off"
        data-1p-ignore
        data-lpignore="true"
        className="mt-1 w-full rounded-lg border border-white/15 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600"
      />
      <div className="mt-1 flex items-center justify-between gap-2">
        <p className={`text-xs ${message?.ok ? "text-emerald-300" : "text-rose-300"}`} role="status">
          {message?.text ?? ""}
        </p>
        <button
          type="button"
          disabled={draft.trim() === ""}
          onClick={() => {
            const r = parseDraftState(draft, slug, teams, knownIds);
            if (!r.ok) {
              setMessage({ ok: false, text: r.error });
              return;
            }
            onImport(r.state);
            setDraft("");
            setMessage({
              ok: true,
              text: `${r.state.picks.length} choix importés${r.dropped ? ` (${r.dropped} ignorés ou hors liste)` : ""}.`,
            });
          }}
          className="min-h-10 shrink-0 rounded-lg border border-white/15 px-3 text-xs text-slate-200 hover:border-white/30 hover:bg-white/5 disabled:opacity-40"
        >
          Importer
        </button>
      </div>

      <div className="mt-4 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={() => {
            if (!armed) {
              setArmed(true);
              return;
            }
            setArmed(false);
            onReset();
          }}
          onBlur={() => setArmed(false)}
          className={`min-h-10 w-full rounded-lg px-3 text-xs font-semibold ${
            armed
              ? "bg-rose-500 text-white hover:bg-rose-400"
              : "border border-rose-400/30 text-rose-200 hover:bg-rose-500/10"
          }`}
        >
          {armed ? "Confirmer : tout effacer (choix et position)" : "Réinitialiser le repêchage"}
        </button>
      </div>
    </section>
  );
}
