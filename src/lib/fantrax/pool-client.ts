/**
 * The player table's data (Captains Dynasty): the whole league pool
 * (`public/fantrax/pool.json`, prospects included) and, once a pipeline
 * publishes it, the dynasty values. Fetched on demand, once per page view,
 * and kept across tab changes. Apart from `league-client.ts` so the tabs'
 * table code does not carry the live Fantrax reads.
 */
import { fantraxDataHref } from "@/lib/site";
import { parseDynasty, type DynastyIndex } from "./extras";
import { isPoolSnapshot, type PoolSnapshot } from "./pool";
import { fetchOptionalJson, fetchSnapshotFile } from "./snapshot-fetch";

let poolPromise: Promise<PoolSnapshot> | null = null;
let poolValue: PoolSnapshot | null = null;
let dynastyPromise: Promise<DynastyIndex | null> | null = null;

/**
 * The player table's pool (required; retried like the snapshot). Fetched
 * once per page view, on demand, and kept across tab changes.
 */
export function loadFantraxPool(): Promise<PoolSnapshot> {
  if (!poolPromise) {
    const p = fetchSnapshotFile<unknown>("pool.json")
      .then((pool) => {
        if (!isPoolSnapshot(pool)) throw new Error("pool.json is malformed");
        poolValue = pool;
        return pool;
      })
      .catch((err) => {
        if (poolPromise === p) poolPromise = null;
        throw err;
      });
    poolPromise = p;
  }
  return poolPromise;
}

/** The pool when this page view already loaded it (a tab change paints at once). */
export function peekFantraxPool(): PoolSnapshot | null {
  return poolValue;
}

/**
 * Dynasty values (`fantrax/dynasty.json`). Only called when the build saw
 * the file (no 404 probe); never rejects (unreadable = null).
 */
export function loadDynasty(): Promise<DynastyIndex | null> {
  if (!dynastyPromise) {
    dynastyPromise = fetchOptionalJson(fantraxDataHref("dynasty.json")).then(parseDynasty, () => null);
  }
  return dynastyPromise;
}
