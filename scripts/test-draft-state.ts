/**
 * Draft state transitions, text export/import, storage resilience.
 * Run: npx tsx scripts/test-draft-state.ts
 */
import assert from "node:assert/strict";
import {
  EMPTY_DRAFT_STATE,
  UNLISTED_PLAYER_ID,
  currentPickNumber,
  markPick,
  myPickIds,
  parseDraftState,
  parseStoredDraftState,
  pickedIds,
  removePickAt,
  serializeDraftState,
  setDraftSlot,
  setPickMine,
  undoLastPick,
} from "../src/lib/draft/draft-state";

let s = EMPTY_DRAFT_STATE;
assert.equal(currentPickNumber(s), 1);
s = markPick(s, 101, false);
s = markPick(s, 102, true);
s = markPick(s, 102, false);
assert.equal(s.picks.length, 2, "a listed player is drafted once");
s = markPick(s, UNLISTED_PLAYER_ID, false);
s = markPick(s, UNLISTED_PLAYER_ID, false);
assert.equal(s.picks.length, 4, "unlisted picks may repeat");
assert.equal(currentPickNumber(s), 5);
assert.deepEqual([...pickedIds(s)], [101, 102]);
assert.deepEqual(myPickIds(s), [102]);
s = undoLastPick(s);
assert.equal(s.picks.length, 3);
s = removePickAt(s, 0);
assert.deepEqual(s.picks.map((p) => p.id), [102, 0]);
assert.equal(removePickAt(s, 9), s, "out of range → same state");
assert.equal(undoLastPick(EMPTY_DRAFT_STATE), EMPTY_DRAFT_STATE);
assert.equal(markPick(s, -3, true), s, "bad id ignored");
assert.equal(EMPTY_DRAFT_STATE.picks.length, 0, "empty state never mutated");

// Owner flip (Entrée vs Maj + Entrée fix): only that pick changes.
{
  const flipped = setPickMine(s, 0, false);
  assert.deepEqual(flipped.picks.map((p) => p.mine), [false, false]);
  assert.equal(setPickMine(s, 0, true), s, "same owner → same state");
  assert.equal(setPickMine(s, 7, true), s, "out of range → same state");
  assert.deepEqual(s.picks.map((p) => p.mine), [true, false], "original untouched");
}

s = setDraftSlot(s, 12, 12);
assert.equal(s.slot, 12);
assert.equal(setDraftSlot(s, 13, 12).slot, null, "slot out of range clears");

// Export / import round trip.
const text = serializeDraftState(s, "light-the-lamp");
assert.equal(text, "repechage:light-the-lamp:v1;position=12;choix=102m,0");
const back = parseDraftState(text, "light-the-lamp", 12, new Set([101, 102]));
assert.ok(back.ok);
if (back.ok) assert.deepEqual(back.state, s);
const unknown = parseDraftState(
  "repechage:light-the-lamp:v1;position=;choix=5m,777,5",
  "light-the-lamp",
  12,
  new Set([5]),
);
assert.ok(unknown.ok);
if (unknown.ok) {
  assert.equal(unknown.state.slot, null);
  assert.deepEqual(unknown.state.picks, [
    { id: 5, mine: true },
    { id: 0, mine: false },
  ]);
  assert.equal(unknown.dropped, 2, "unknown id kept as unlisted, duplicate dropped");
}
assert.ok(!parseDraftState("hello", "light-the-lamp", 12).ok);
assert.ok(!parseDraftState("repechage:light-the-lamp:v1;position=40;choix=", "light-the-lamp", 12).ok);
assert.ok(!parseDraftState("repechage:light-the-lamp:v1;choix=12x", "light-the-lamp", 12).ok);
assert.ok(!parseDraftState("repechage:other:v1;choix=1", "light-the-lamp", 12).ok);

// Stored payloads: garbage and wrong shapes fall back to empty.
assert.equal(parseStoredDraftState(null, 12), EMPTY_DRAFT_STATE);
assert.equal(parseStoredDraftState("{not json", 12), EMPTY_DRAFT_STATE);
assert.equal(parseStoredDraftState('{"v":2,"picks":[]}', 12), EMPTY_DRAFT_STATE);
const stored = parseStoredDraftState(
  JSON.stringify({ v: 1, slot: 4, picks: [{ id: 9, mine: true }, { id: 9, mine: false }, { id: "x" }] }),
  12,
);
assert.deepEqual(stored, { v: 1, slot: 4, picks: [{ id: 9, mine: true }] });

// Store: throwing localStorage must not break reads or writes.
(async () => {
  const listeners: Array<(e: unknown) => void> = [];
  const g = globalThis as unknown as { window: unknown };
  g.window = {
    localStorage: {
      getItem() {
        throw new Error("SecurityError");
      },
      setItem() {
        throw new Error("QuotaExceeded");
      },
    },
    addEventListener: (_: string, l: (e: unknown) => void) => listeners.push(l),
    removeEventListener: () => {},
  };
  const { getDraftStore } = await import("../src/lib/draft/draft-store");
  const store = getDraftStore("test-league", 12);
  assert.equal(store.getServerSnapshot(), EMPTY_DRAFT_STATE);
  assert.equal(store.getSnapshot(), EMPTY_DRAFT_STATE, "blocked storage → empty draft");
  let notified = 0;
  const off = store.subscribe(() => notified++);
  const next = markPick(store.getSnapshot(), 42, true);
  store.set(next);
  assert.equal(store.getSnapshot(), next, "state kept in memory");
  assert.equal(notified, 1);
  assert.equal(store.persistent(), false);
  off();

  // Working storage persists and reloads.
  const mem = new Map<string, string>();
  g.window = {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const store2 = getDraftStore("test-league-2", 12);
  store2.set(markPick(EMPTY_DRAFT_STATE, 7, false));
  assert.equal(store2.persistent(), true);
  const saved = mem.get("vor-draft:test-league-2:v1");
  assert.ok(saved);
  assert.deepEqual(parseStoredDraftState(saved, 12).picks, [{ id: 7, mine: false }]);
  delete (globalThis as { window?: unknown }).window;
  console.log("OK: draft-state");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
