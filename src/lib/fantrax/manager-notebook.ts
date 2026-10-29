/** Personal hypotheses, separate from Fantrax transactions and model output. */
export const NOTEBOOK_LIMIT = 300;
export const NOTE_KINDS = ["surveiller", "alignement", "ballottage", "echange", "proteger"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];
export type NoteOutcome = "pending" | "validated" | "rejected";
export interface ManagerNote {
  id: string;
  title: string;
  thesis: string;
  kind: NoteKind;
  reviewDate: string;
  outcome: NoteOutcome;
  createdAt: string;
  updatedAt: string;
}
export interface NotebookFile {
  version: 1;
  league: string;
  team: string;
  notes: ManagerNote[];
}
const EMPTY_NOTES: readonly ManagerNote[] = Object.freeze([]);
const validTime = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));
export function validReviewDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
function isNote(value: unknown): value is ManagerNote {
  if (!value || typeof value !== "object") return false;
  const n = value as Record<string, unknown>;
  return typeof n.id === "string" && n.id.length > 0 && n.id.length <= 100 &&
    typeof n.title === "string" && n.title.trim().length > 0 && n.title.length <= 120 &&
    typeof n.thesis === "string" && n.thesis.length <= 1200 &&
    NOTE_KINDS.includes(n.kind as NoteKind) && validReviewDate(n.reviewDate) &&
    ["pending", "validated", "rejected"].includes(n.outcome as string) &&
    validTime(n.createdAt) && validTime(n.updatedAt) && Date.parse(n.updatedAt) >= Date.parse(n.createdAt);
}
/** Strict scope validation prevents importing another team's decisions here. */
export function parseNotebook(raw: string, league: string, team: string): ManagerNote[] | null {
  if (raw.length > 1_000_000) return null;
  try {
    const f = JSON.parse(raw) as NotebookFile;
    if (f?.version !== 1 || f.league !== league || f.team !== team || !Array.isArray(f.notes) ||
      f.notes.length > NOTEBOOK_LIMIT || !f.notes.every(isNote) || new Set(f.notes.map(n => n.id)).size !== f.notes.length) return null;
    return f.notes;
  } catch { return null; }
}
export function notebookFile(league: string, team: string, notes: readonly ManagerNote[]): NotebookFile {
  return { version: 1, league, team, notes: [...notes] };
}
/** Latest edit wins; import never erases a decision missing from a backup. */
export function mergeNotes(current: readonly ManagerNote[], incoming: readonly ManagerNote[]): ManagerNote[] | null {
  const entries = new Map(current.map(n => [n.id, n]));
  for (const n of incoming) {
    const prev = entries.get(n.id);
    if (!prev || Date.parse(n.updatedAt) > Date.parse(prev.updatedAt)) entries.set(n.id, n);
  }
  return entries.size > NOTEBOOK_LIMIT ? null : [...entries.values()];
}
export function notesDue(notes: readonly ManagerNote[], today: string): number {
  return notes.filter(n => n.outcome === "pending" && n.reviewDate <= today).length;
}
/** Clock corrections or an imported backup must never make a note invalid. */
export function nextNoteTimestamp(note: Pick<ManagerNote, "createdAt" | "updatedAt">, nowMs: number): string {
  return new Date(Math.min(8.64e15, Math.max(nowMs, Date.parse(note.createdAt), Date.parse(note.updatedAt) + 1))).toISOString();
}
/** Apply edits to the latest stored note, preserving its current outcome. */
export function updateManagerNote(note: ManagerNote, changes: Partial<Pick<ManagerNote, "title" | "thesis" | "kind" | "reviewDate" | "outcome">>, nowMs: number): ManagerNote {
  return { ...note, ...changes, updatedAt: nextNoteTimestamp(note, nowMs) };
}
export const notebookStorageKey = (league: string, team: string) => `fantrax-notebook:v1:${encodeURIComponent(league)}:${encodeURIComponent(team)}`;
interface NotebookStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): readonly ManagerNote[];
  getServerSnapshot(): readonly ManagerNote[];
  /** Read persisted changes first; null from the mutation cancels the write. */
  update(change: (current: readonly ManagerNote[]) => readonly ManagerNote[] | null): boolean;
  persistent(): boolean;
}
const stores = new Map<string, NotebookStore>();
export function getNotebookStore(league: string, team: string): NotebookStore {
  const key = notebookStorageKey(league, team);
  const existing = stores.get(key);
  if (existing) return existing;
  let state: readonly ManagerNote[] | null = null;
  let saved = true;
  const listeners = new Set<() => void>();
  const read = () => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return EMPTY_NOTES;
      const parsed = parseNotebook(raw, league, team);
      if (!parsed) saved = false;
      return parsed;
    } catch { saved = false; return null; }
  };
  const emit = () => listeners.forEach(l => l());
  const reload = () => { state = read() ?? state ?? EMPTY_NOTES; emit(); };
  const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) reload(); };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted) reload(); };
  const store: NotebookStore = {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", storage);
        window.addEventListener("pageshow", pageshow);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && typeof window !== "undefined") {
          window.removeEventListener("storage", storage);
          window.removeEventListener("pageshow", pageshow);
          state = null;
        }
      };
    },
    getSnapshot() { return state ?? (state = typeof window === "undefined" ? EMPTY_NOTES : read() ?? EMPTY_NOTES); },
    getServerSnapshot() { return EMPTY_NOTES; },
    update(change) {
      const latest = read();
      // A failed earlier write has unsaved in-memory changes. Keep those
      // until storage works again instead of restoring its older disk copy.
      const current = saved ? latest ?? state ?? EMPTY_NOTES : state ?? latest ?? EMPTY_NOTES;
      const notes = change(current);
      if (!notes || notes.length > NOTEBOOK_LIMIT || !notes.every(isNote) || new Set(notes.map(n => n.id)).size !== notes.length) {
        state = current;
        emit();
        return false;
      }
      state = notes;
      try { window.localStorage.setItem(key, JSON.stringify(notebookFile(league, team, notes))); saved = true; }
      catch { saved = false; }
      emit();
      return true;
    },
    persistent() { return saved; },
  };
  stores.set(key, store);
  return store;
}
