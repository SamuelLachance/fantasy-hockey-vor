import assert from "node:assert/strict";
import { getNotebookStore, mergeNotes, nextNoteTimestamp, notebookFile, notebookStorageKey, notesDue, parseNotebook, updateManagerNote, validReviewDate, type ManagerNote } from "../src/lib/fantrax/manager-notebook";

const note: ManagerNote = { id: "n1", title: "Surveiller le rôle", thesis: "Vérifier après trois matchs", kind: "surveiller", reviewDate: "2026-10-29", outcome: "pending", createdAt: "2026-10-20T12:00:00Z", updatedAt: "2026-10-20T12:00:00Z" };
const raw = JSON.stringify(notebookFile("slapshot", "team-a", [note]));
assert.deepEqual(parseNotebook(raw, "slapshot", "team-a"), [note]);
assert.equal(parseNotebook(raw, "captains-dynasty", "team-a"), null, "another league cannot overwrite the notebook");
assert.equal(parseNotebook(raw, "slapshot", "team-b"), null, "another team cannot overwrite the notebook");
assert.equal(parseNotebook("{broken", "slapshot", "team-a"), null);
assert.equal(parseNotebook(JSON.stringify({ ...notebookFile("slapshot", "team-a", [note]), version: 2 }), "slapshot", "team-a"), null);
for (const patch of [{ reviewDate: "2026-02-30" }, { outcome: "executed" }, { kind: "fake" }, { title: " " }, { updatedAt: "2000-01-01" }, { createdAt: "invalid" }]) {
  assert.equal(parseNotebook(JSON.stringify(notebookFile("slapshot", "team-a", [{ ...note, ...patch } as ManagerNote])), "slapshot", "team-a"), null, `reject malformed entry ${JSON.stringify(patch)}`);
}
assert.equal(parseNotebook(JSON.stringify(notebookFile("slapshot", "team-a", [note, note])), "slapshot", "team-a"), null, "duplicate IDs are invalid");
assert(validReviewDate("2028-02-29"));
assert(!validReviewDate("2026-02-29"));
assert.equal(notesDue([note, { ...note, id: "future", reviewDate: "2026-10-30" }, { ...note, id: "closed", outcome: "validated" }], "2026-10-29"), 1);
const edited = { ...note, title: "Révisé", updatedAt: "2026-10-29T12:00:00Z" };
assert.deepEqual(mergeNotes([edited], [note]), [edited], "old backup cannot undo newer decision");
assert.deepEqual(mergeNotes([note], [edited]), [edited]);
assert.equal(mergeNotes([note], [{ ...note, id: "n2" }])?.length, 2, "merge retains records absent from the backup");
assert.equal(mergeNotes(Array.from({ length: 300 }, (_, i) => ({ ...note, id: String(i) })), [note]), null, "no silent truncation at storage limit");
assert.notEqual(notebookStorageKey("a:b", "c"), notebookStorageKey("a", "b:c"), "storage scope cannot collide");
const future: ManagerNote = { ...note, id: "future-clock", createdAt: "2099-01-01T12:00:00Z", updatedAt: "2099-01-02T12:00:00Z" };
const clockNow = Date.parse("2026-10-29T12:00:00Z");
assert(Date.parse(nextNoteTimestamp(future, clockNow)) > Date.parse(future.updatedAt), "clock correction cannot move an imported note backward");
const reviewedFuture = updateManagerNote(future, { outcome: "validated" }, clockNow);
assert(parseNotebook(JSON.stringify(notebookFile("slapshot", "team-a", [note, reviewedFuture])), "slapshot", "team-a"), "editing a future-dated backup must not invalidate the entire notebook on reload");

// A tab can miss its storage event while suspended. Mutation must re-read
// the disk, then apply its edit to the latest note instead of its old form.
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const disk = new Map<string, string>();
let failWrites = false;
Object.defineProperty(globalThis, "window", { configurable: true, value: {
  localStorage: {
    getItem(key: string) { return disk.get(key) ?? null; },
    setItem(key: string, value: string) { if (failWrites) throw new Error("storage blocked"); disk.set(key, value); },
  },
  addEventListener() {},
  removeEventListener() {},
} });
try {
  const league = "notebook-test";
  const team = "stale-tab";
  const key = notebookStorageKey(league, team);
  disk.set(key, JSON.stringify(notebookFile(league, team, [note])));
  const store = getNotebookStore(league, team);
  assert.equal(store.getSnapshot().length, 1);
  const external = { ...note, id: "other-tab", title: "Autre onglet" };
  const latest = updateManagerNote(note, { outcome: "validated" }, clockNow);
  disk.set(key, JSON.stringify(notebookFile(league, team, [latest, external])));
  assert.equal(store.getSnapshot().length, 1, "simulate an old in-memory snapshot before storage event delivery");
  assert(store.update(current => current.map(n => n.id === note.id ? updateManagerNote(n, { title: "Hypothèse révisée" }, clockNow) : n)));
  const saved = parseNotebook(disk.get(key)!, league, team)!;
  assert.equal(saved.length, 2, "an edit preserves a newly added note in another tab");
  assert.equal(saved.find(n => n.id === note.id)?.outcome, "validated", "editing a stale form preserves the latest outcome");
  assert.equal(saved.find(n => n.id === note.id)?.title, "Hypothèse révisée");

  const full = Array.from({ length: 300 }, (_, i) => ({ ...note, id: `full-${i}`, outcome: "validated" as const }));
  disk.set(key, JSON.stringify(notebookFile(league, team, full)));
  assert(store.update(current => current.filter(n => n.id !== "full-0")), "deleting a completed decision frees a slot at the limit");
  assert.equal(store.getSnapshot().length, 299);
  assert(store.update(current => [...current, updateManagerNote(full[0]!, {}, clockNow)]), "undo restores a removed decision without duplicates");
  assert.equal(store.getSnapshot().length, 300);
  assert.equal(store.update(current => [...current, external]), false, "mutations cannot silently exceed the quota");
  assert.equal(parseNotebook(disk.get(key)!, league, team)?.length, 300, "a rejected mutation preserves the saved notebook");

  const otherKey = notebookStorageKey(league, "unrelated-team");
  disk.set(otherKey, raw);
  const current = store.getSnapshot();
  failWrites = true;
  assert(store.update(() => current.filter(n => n.id !== "full-1")));
  assert.equal(store.persistent(), false);
  assert.equal(store.getSnapshot().length, 299, "unsaved edits remain available for backup when disk writes fail");
  assert(store.update(entries => entries.filter(n => n.id !== "full-2")));
  assert.equal(store.getSnapshot().length, 298, "a second mutation cannot resurrect the older disk copy after a failed write");
  failWrites = false;
  assert(store.update(entries => entries));
  assert.equal(store.persistent(), true);
  assert.equal(parseNotebook(disk.get(key)!, league, team)?.length, 298);
  assert.equal(disk.get(otherKey), raw, "mutations remain scoped to the selected team");
} finally {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
}
console.log("OK: Fantrax notebook validation, scope, reminders, monotone edits, stale tabs, deletion and backup merge");
