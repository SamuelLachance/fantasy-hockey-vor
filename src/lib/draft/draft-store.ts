import {
  EMPTY_DRAFT_STATE,
  parseStoredDraftState,
  type DraftState,
} from "./draft-state";

/**
 * localStorage-backed external store for `useSyncExternalStore`.
 *
 * The page is prerendered, so the server snapshot is always the empty draft;
 * the browser snapshot is read lazily on first use. Every storage access is
 * wrapped: private windows, blocked site data or a full quota must leave a
 * fully working (just not remembered) helper. Other tabs stay in sync via
 * the `storage` event.
 *
 * The module outlives a page under client-side navigation (a page restored
 * from the back/forward cache keeps it too), while `storage` events are
 * only heard with a subscriber: the cached state is dropped when the last
 * subscriber leaves, and re-read on a `pageshow` from the cache, so a pick
 * marked in another tab meanwhile is never overwritten by a stale copy.
 */
export interface DraftStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): DraftState;
  getServerSnapshot(): DraftState;
  set(next: DraftState): void;
  /** False once a read or write has failed (UI shows "not saved"). */
  persistent(): boolean;
}

const stores = new Map<string, DraftStore>();

export function draftStorageKey(slug: string): string {
  return `vor-draft:${slug}:v1`;
}

export function getDraftStore(slug: string, teams: number): DraftStore {
  const key = draftStorageKey(slug);
  const existing = stores.get(key);
  if (existing) return existing;

  let state: DraftState | null = null;
  let ok = true;
  const listeners = new Set<() => void>();

  const read = (): DraftState => {
    try {
      return parseStoredDraftState(window.localStorage.getItem(key), teams);
    } catch (_error) {
      ok = false;
      return EMPTY_DRAFT_STATE;
    }
  };
  const emit = () => {
    for (const l of listeners) l();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key !== key && e.key !== null) return;
    state = read();
    emit();
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (!e.persisted) return;
    state = read();
    emit();
  };

  const store: DraftStore = {
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1 && typeof window !== "undefined") {
        window.addEventListener("storage", onStorage);
        window.addEventListener("pageshow", onPageShow);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && typeof window !== "undefined") {
          window.removeEventListener("storage", onStorage);
          window.removeEventListener("pageshow", onPageShow);
          // Nobody hears `storage` any more: the next reader re-reads.
          state = null;
        }
      };
    },
    getSnapshot() {
      if (state === null) state = typeof window === "undefined" ? EMPTY_DRAFT_STATE : read();
      return state;
    },
    getServerSnapshot() {
      return EMPTY_DRAFT_STATE;
    },
    set(next) {
      if (next === state) return;
      state = next;
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
        ok = true;
      } catch (_error) {
        ok = false;
      }
      emit();
    },
    persistent() {
      return ok;
    },
  };
  stores.set(key, store);
  return store;
}
