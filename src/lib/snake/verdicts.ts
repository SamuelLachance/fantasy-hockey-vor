/**
 * Snake's verdicts for the player tables and chips, as tiny external
 * stores (`useSyncExternalStore`): the compact Fantrax-keyed file
 * (`snake/fantrax.json`) and the NHL-keyed one (`snake/nhl.json`). A store
 * starts its fetch as soon as a page subscribes to it (no idle wait: the
 * verdicts are part of the tables), unless the page's build-time seed
 * already covers every player it shows (`complete`). The full index
 * (`snake/index.json`: projection, opinion counts) is only fetched for the
 * « Opinions » column or sort.
 */
import { parseSnakeIndex, type SnakeIndex } from "@/lib/fantrax/extras";
import { loadSnakeFantrax, loadSnakeIndex, loadSnakeNhl } from "./client";
import type { SnakeFantraxFile, SnakeNhlFile } from "./types";

export type VerdictKind = "fx" | "nhl";
export type VerdictStatus = "idle" | "loading" | "ready" | "error";

export type VerdictRows<K extends VerdictKind> = K extends "fx" ? SnakeFantraxFile["rows"] : SnakeNhlFile["rows"];

interface Store<T> {
  value: T | null;
  status: VerdictStatus;
  listeners: Set<() => void>;
  load: () => Promise<T>;
}

function store<T>(load: () => Promise<T>): Store<T> {
  return { value: null, status: "idle", listeners: new Set(), load };
}

const stores = {
  fx: store(() => loadSnakeFantrax().then((f) => f.rows)),
  nhl: store(() => loadSnakeNhl().then((f) => f.rows)),
};
const full = store<SnakeIndex | null>(() => loadSnakeIndex().then((f) => parseSnakeIndex(f)));

function emit(s: Store<unknown>): void {
  for (const l of s.listeners) l();
}

function start<T>(s: Store<T>): void {
  if (s.status === "loading" || s.status === "ready") return;
  s.status = "loading";
  emit(s as Store<unknown>);
  s.load().then(
    (v) => {
      s.value = v;
      s.status = "ready";
      emit(s as Store<unknown>);
    },
    () => {
      // A later subscriber (next page, retry) tries again.
      s.status = "error";
      emit(s as Store<unknown>);
    },
  );
}

/**
 * Subscribe to a verdict store; the first subscriber starts the fetch at
 * once. With `complete` (the page's seed covers every player it shows),
 * nothing is fetched.
 */
export function subscribeVerdicts(kind: VerdictKind, cb: () => void, opts: { complete?: boolean } = {}): () => void {
  const s = stores[kind] as Store<unknown>;
  s.listeners.add(cb);
  if (!opts.complete && s.status !== "ready" && s.status !== "loading") start(s);
  return () => {
    s.listeners.delete(cb);
  };
}

export function getVerdictRows<K extends VerdictKind>(kind: K): VerdictRows<K> | null {
  return stores[kind].value as VerdictRows<K> | null;
}

export function getVerdictStatus(kind: VerdictKind): VerdictStatus {
  return stores[kind].status;
}

// ------------------------------------------------------------ full index (on demand)

/** Fetch `snake/index.json` now (the « Opinions » column or sort asked for it). */
export function ensureFullSnakeIndex(): void {
  start(full);
}

export function subscribeFullSnakeIndex(cb: () => void): () => void {
  full.listeners.add(cb);
  return () => {
    full.listeners.delete(cb);
  };
}

export function getFullSnakeIndex(): SnakeIndex | null {
  return full.value;
}

export function getFullSnakeStatus(): VerdictStatus {
  return full.status;
}

/** Test helper: back to a fresh page view. */
export function resetVerdictStores(): void {
  for (const s of [stores.fx, stores.nhl, full] as Store<unknown>[]) {
    s.value = null;
    s.status = "idle";
    s.listeners.clear();
  }
}
