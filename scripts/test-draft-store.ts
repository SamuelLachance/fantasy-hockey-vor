/**
 * Unit checks for the draft helper's localStorage store with a fake
 * `window`: tab sync, remount after another tab wrote (client navigation
 * keeps the module alive), back/forward cache restores, failing storage.
 * Run: npx tsx scripts/test-draft-store.ts
 */
import { markPick, setDraftSlot } from "../src/lib/draft/draft-state";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    failed++;
  }
}
const eq = (a: unknown, b: unknown, msg: string) =>
  assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ---- fake browser
type Listener = (e: { key?: string | null; persisted?: boolean }) => void;
const data = new Map<string, string>();
let throwOnSet = false;
const listeners = new Map<string, Set<Listener>>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (throwOnSet) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
  },
  addEventListener: (type: string, fn: Listener) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Listener) => listeners.get(type)?.delete(fn),
};
const fire = (type: string, e: { key?: string | null; persisted?: boolean }) => {
  for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
};
(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;

async function main() {
  const { draftStorageKey, getDraftStore } = await import("../src/lib/draft/draft-store");
  const KEY = "vor-draft:light-the-lamp:v1";
  eq(draftStorageKey("light-the-lamp"), KEY, "storage key unchanged (an in-progress draft survives)");

  const TEAMS = 12;
  const store = getDraftStore("light-the-lamp", TEAMS);
  assert(getDraftStore("light-the-lamp", TEAMS) === store, "one store per key");

  // Another tab (or an earlier visit) wrote a draft with one pick.
  const other = markPick(setDraftSlot(store.getServerSnapshot(), 5, TEAMS), 8478402, false);
  data.set(KEY, JSON.stringify(other));

  // Page A mounts: reads it.
  let emits = 0;
  const unsubA = store.subscribe(() => emits++);
  eq(store.getSnapshot().picks.length, 1, "first read");
  eq(store.getSnapshot().slot, 5, "slot read");
  assert(store.getSnapshot() === store.getSnapshot(), "stable snapshot between changes");

  // A storage event for the key updates; another key does not.
  data.set(KEY, JSON.stringify(markPick(other, 8477934, true)));
  fire("storage", { key: "autre-cle" });
  eq(store.getSnapshot().picks.length, 1, "other key ignored");
  fire("storage", { key: KEY });
  eq(store.getSnapshot().picks.length, 2, "storage event for the key re-reads");
  assert(emits >= 1, "subscribers told");

  // Client navigation away: the last subscriber leaves, listeners go too.
  unsubA();
  eq(listeners.get("storage")?.size ?? 0, 0, "no storage listener without subscribers");
  eq(listeners.get("pageshow")?.size ?? 0, 0, "no pageshow listener without subscribers");

  // Meanwhile another tab marks a third pick (no one hears the event here).
  data.set(KEY, JSON.stringify(markPick(markPick(other, 8477934, true), 8481559, false)));

  // Back to the helper: remount must see the other tab's pick, and marking
  // a new one must not overwrite it.
  const unsubB = store.subscribe(() => {});
  eq(store.getSnapshot().picks.length, 3, "remount re-reads storage (no stale cached state)");
  store.set(markPick(store.getSnapshot(), 8479318, true));
  eq((JSON.parse(data.get(KEY)!) as { picks: unknown[] }).picks.length, 4, "new pick written on top of the other tab's");

  // Back/forward cache: the page is restored with the module; re-read on pageshow.
  data.set(KEY, JSON.stringify(markPick(JSON.parse(data.get(KEY)!), 8480800, false)));
  fire("pageshow", { persisted: false });
  eq(store.getSnapshot().picks.length, 4, "a normal pageshow changes nothing");
  fire("pageshow", { persisted: true });
  eq(store.getSnapshot().picks.length, 5, "pageshow from the back/forward cache re-reads");

  // Storage that refuses writes: the helper still works, and says it is not saved.
  assert(store.persistent(), "persistent while writes succeed");
  throwOnSet = true;
  store.set(markPick(store.getSnapshot(), 8482000, false));
  eq(store.getSnapshot().picks.length, 6, "the change still applies in memory");
  assert(!store.persistent(), "persistent() turns false after a failed write");
  throwOnSet = false;
  store.set(markPick(store.getSnapshot(), 8482001, false));
  assert(store.persistent(), "persistent() recovers after a successful write");
  unsubB();

  if (failed) process.exit(1);
  console.log("OK: draft store (tab sync, remount, back/forward cache, failing storage)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
