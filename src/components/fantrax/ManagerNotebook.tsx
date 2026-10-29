"use client";

import { BookOpen, Download, Plus, Upload } from "lucide-react";
import { useId, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { torontoDate } from "@/lib/fantrax/dates";
import { getNotebookStore, mergeNotes, notebookFile, NOTEBOOK_LIMIT, notesDue, parseNotebook, updateManagerNote, validReviewDate, type ManagerNote, type NoteKind, type NoteOutcome } from "@/lib/fantrax/manager-notebook";
import { useFantraxLeague } from "./fantrax-league-context";
import { LeagueCard } from "./LeagueCard";

const KINDS: Record<NoteKind, string> = { surveiller: "Surveiller", alignement: "Alignement", ballottage: "Ballottage", echange: "Échange", proteger: "Protéger" };
const OUTCOMES: Record<NoteOutcome, string> = { pending: "À vérifier", validated: "Hypothèse confirmée", rejected: "Hypothèse invalidée" };
const field = "min-h-11 w-full rounded-xl border border-white/15 bg-slate-950 px-3 py-2 text-sm text-white";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/15 px-3 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-40";

function Notebook({ league, team, today }: { league: string; team: string; today: string | null }) {
  const store = getNotebookStore(league, team);
  const notes = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const [filter, setFilter] = useState<"open" | "due" | "closed">("open");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<ManagerNote | null>(null);
  const [deleted, setDeleted] = useState<ManagerNote | null>(null);
  const [message, setMessage] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const prefix = useId();
  const due = today ? notesDue(notes, today) : 0;
  const visible = notes.filter(n => filter === "closed" ? n.outcome !== "pending" : n.outcome === "pending" && (filter !== "due" || !!today && n.reviewDate <= today))
    .toSorted((a, b) => a.reviewDate.localeCompare(b.reviewDate) || b.updatedAt.localeCompare(a.updatedAt));
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const title = String(data.get("title") ?? "").trim();
    const reviewDate = String(data.get("date") ?? "");
    if (!title || !validReviewDate(reviewDate)) return;
    const now = new Date().getTime();
    const time = new Date(now).toISOString();
    const changes = { title, thesis: String(data.get("thesis") ?? "").trim(), kind: String(data.get("kind")) as NoteKind, reviewDate };
    const id = editing?.id ?? crypto.randomUUID();
    const accepted = store.update(current => {
      if (editing) {
        const latest = current.find(n => n.id === id);
        return latest ? current.map(n => n.id === id ? updateManagerNote(latest, changes, now) : n) : null;
      }
      return current.length >= NOTEBOOK_LIMIT ? null : [...current, { ...changes, id, outcome: "pending", createdAt: time, updatedAt: time }];
    });
    if (!accepted) { setMessage(editing ? "Ce suivi n’est plus disponible. Vérifiez le carnet avant de réessayer." : `Le carnet contient déjà ${NOTEBOOK_LIMIT} entrées. Exportez-le, puis supprimez des bilans pour libérer de la place.`); return; }
    setAdding(false);
    setEditing(null);
    setFilter("open");
    setMessage(editing ? "Suivi modifié." : "Décision ajoutée au suivi.");
  }
  function outcome(id: string, value: NoteOutcome) {
    const now = new Date().getTime();
    const accepted = store.update(current => current.some(n => n.id === id) ? current.map(n => n.id === id ? updateManagerNote(n, { outcome: value }, now) : n) : null);
    setMessage(!accepted ? "Ce suivi n’est plus disponible." : value === "pending" ? "Suivi rouvert." : "Bilan enregistré. Votre hypothèse reste dans l’historique.");
  }
  function remove(id: string) {
    let removed: ManagerNote | null = null;
    const accepted = store.update(current => {
      removed = current.find(n => n.id === id && n.outcome !== "pending") ?? null;
      return removed ? current.filter(n => n.id !== id) : null;
    });
    if (!accepted || !removed) { setMessage("Ce bilan a déjà été supprimé ou son suivi a été rouvert."); return; }
    setDeleted(removed);
    if (editing?.id === id) { setEditing(null); setAdding(false); }
    setMessage("Bilan supprimé. Vous pouvez annuler cette suppression.");
  }
  function undoRemove() {
    if (!deleted) return;
    const now = new Date().getTime();
    const accepted = store.update(current => {
      if (current.some(n => n.id === deleted.id)) return current;
      return current.length >= NOTEBOOK_LIMIT ? null : [...current, updateManagerNote(deleted, {}, now)];
    });
    if (!accepted) { setMessage("Le carnet est plein. Libérez une place pour restaurer ce bilan."); return; }
    setDeleted(null);
    setFilter("closed");
    setMessage("Suppression annulée. Le bilan est restauré.");
  }
  function exportNotes() {
    const blob = new Blob([JSON.stringify(notebookFile(league, team, store.getSnapshot()), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `carnet-${league}-${team}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importNotes(file: File) {
    if (file.size > 1_000_000) { setMessage("Fichier trop volumineux (maximum 1 Mo)."); return; }
    try {
      const incoming = parseNotebook(await file.text(), league, team);
      if (!incoming) { setMessage("Import impossible : fichier invalide ou carnet d’une autre ligue ou équipe."); return; }
      const accepted = store.update(current => mergeNotes(current, incoming));
      if (!accepted) { setMessage(`Import impossible : la fusion dépasserait ${NOTEBOOK_LIMIT} entrées.`); return; }
      setMessage("Carnet fusionné. Les décisions existantes sont conservées; la modification la plus récente prévaut.");
    } catch { setMessage("Ce fichier n’a pas pu être lu. Votre carnet est conservé."); }
  }
  return (
    <LeagueCard id="carnet" icon={<BookOpen className="h-5 w-5" />} title="Carnet du DG" description="Posez une hypothèse, fixez une date de révision et confrontez votre décision aux résultats.">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 rounded-xl bg-slate-950 p-1" role="group" aria-label="Filtrer le carnet">
          {([["open", "En suivi"], ["due", `À revoir (${due})`], ["closed", "Bilans"]] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`min-h-11 rounded-lg px-3 text-sm ${filter === value ? "bg-cyan-400/15 font-semibold text-cyan-200" : "text-slate-400 hover:text-white"}`}>{label}</button>)}
        </div>
        <button type="button" className={`${button} border-cyan-400/30 text-cyan-200`} onClick={() => { setEditing(null); setAdding(!adding || !!editing); }} aria-expanded={adding} aria-controls={`${prefix}-form`}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un suivi</button>
      </div>
      {adding ? <form key={editing?.id ?? "new"} id={`${prefix}-form`} onSubmit={add} className="mt-4 grid gap-4 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.03] p-4 sm:grid-cols-2">
        <p className="text-sm font-semibold text-cyan-200 sm:col-span-2">{editing ? "Modifier le suivi" : "Nouveau suivi"}</p>
        <label className="grid gap-1.5 text-xs text-slate-300">Joueur ou décision<input name="title" required maxLength={120} defaultValue={editing?.title} className={field} placeholder="Ex. : surveiller le rôle de mon jeune défenseur" /></label>
        <label className="grid gap-1.5 text-xs text-slate-300">Type de suivi<select name="kind" defaultValue={editing?.kind} className={field}>{Object.entries(KINDS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="grid gap-1.5 text-xs text-slate-300 sm:col-span-2">Hypothèse et condition de décision<textarea name="thesis" maxLength={1200} rows={3} defaultValue={editing?.thesis} className={field} placeholder="Quel changement attendez-vous? Qu’est-ce qui confirmerait ou invaliderait votre idée?" /></label>
        <label className="grid gap-1.5 text-xs text-slate-300">À revoir le<input name="date" type="date" required defaultValue={editing?.reviewDate ?? today ?? undefined} className={field} /></label>
        <div className="flex items-end gap-2"><button type="submit" className={`${button} bg-cyan-400/10`}>Enregistrer</button><button type="button" className={button} onClick={() => setAdding(false)}>Annuler</button></div>
      </form> : null}
      <p role="status" className="mt-3 text-sm text-cyan-200">{message}</p>
      {deleted ? <button type="button" onClick={undoRemove} className={`${button} mt-2 border-cyan-400/30 text-cyan-200`}>Annuler la suppression de « {deleted.title} »</button> : null}
      {!store.persistent() ? <p role="alert" className="mb-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">La sauvegarde locale est indisponible ou illisible. Exportez votre carnet avant de quitter la page.</p> : null}
      {visible.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">
        {visible.map(note => <li key={note.id} className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/[0.025] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs"><span className="text-cyan-300">{KINDS[note.kind]}</span><time dateTime={note.reviewDate} className={note.outcome === "pending" && today && note.reviewDate <= today ? "font-medium text-amber-200" : "text-slate-400"}>À revoir : {note.reviewDate}</time></div>
          <h3 className="break-words font-semibold text-white">{note.title}</h3>
          {note.thesis ? <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-300">{note.thesis}</p> : null}
          <button type="button" className="inline-flex min-h-11 items-center self-start rounded-lg text-xs font-medium text-cyan-300 hover:text-white" onClick={() => { setEditing(note); setAdding(true); document.getElementById("carnet")?.scrollIntoView({ block: "start" }); }}>Modifier l’hypothèse ou la date</button>
          <label className="mt-auto grid gap-1 text-xs text-slate-400">Bilan de « {note.title} »<select value={note.outcome} onChange={event => outcome(note.id, event.target.value as NoteOutcome)} className={field}>{Object.entries(OUTCOMES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          {note.outcome !== "pending" ? <button type="button" onClick={() => remove(note.id)} className="inline-flex min-h-11 items-center self-start rounded-lg text-xs font-medium text-rose-300 hover:text-rose-100">Supprimer ce bilan<span className="sr-only"> : {note.title}</span></button> : null}
        </li>)}
      </ul> : <div className="mt-3 rounded-xl border border-dashed border-white/15 px-4 py-7 text-center text-sm text-slate-400">{filter === "due" ? "Aucun suivi à revoir aujourd’hui." : filter === "closed" ? "Les hypothèses évaluées apparaîtront ici." : "Votre prochaine décision mérite un suivi. Notez le joueur, votre raisonnement et la date de révision."}</div>}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4">
        <button type="button" className={button} onClick={exportNotes} disabled={!notes.length}><Download className="h-4 w-4" aria-hidden="true" />Exporter</button>
        <button type="button" className={button} onClick={() => importInput.current?.click()}><Upload className="h-4 w-4" aria-hidden="true" />Importer</button>
        <input ref={importInput} type="file" accept="application/json,.json" className="sr-only" aria-label="Importer un carnet JSON" onChange={event => { const file = event.target.files?.[0]; if (file) void importNotes(file); event.target.value = ""; }} />
        <p className="text-xs text-slate-400 sm:ml-auto">{notes.length} / {NOTEBOOK_LIMIT} entrées · Dans ce navigateur, par ligue et par équipe.</p>
      </div>
    </LeagueCard>
  );
}

export function ManagerNotebook() {
  const { config, teamId, nowMs } = useFantraxLeague();
  return <Notebook key={`${config.slug}:${teamId}`} league={config.slug} team={teamId} today={nowMs === null ? null : torontoDate(nowMs)} />;
}
